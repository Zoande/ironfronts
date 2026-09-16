import { mat4, quat, vec3, type ReadonlyVec3 } from 'gl-matrix';
import { align4 } from './gpu-utils';

const GLB_JSON = 0x4e4f534a;
const GLB_BINARY = 0x004e4942;
const ANIMATION_FPS = 30;
/** Idle holds a single Forward frame; Forward/Backward loop, phased by track
 *  distance travelled the same way the infantry model phases its stride. */
const REQUIRED_CLIPS = ['Tank_Forward', 'Tank_Backwards'] as const;
const ROOT_BONE_NAME = 'Root';

type AnimationPath = 'translation' | 'rotation' | 'scale';
interface GltfAccessor { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; }
interface GltfBufferView { byteOffset?: number; byteLength: number; byteStride?: number; }
interface GltfNode {
  name?: string; children?: number[]; mesh?: number; skin?: number;
  translation?: [number, number, number]; rotation?: [number, number, number, number]; scale?: [number, number, number];
}
interface GltfAnimation {
  name?: string;
  samplers: Array<{ input: number; output: number; interpolation?: string }>;
  channels: Array<{ sampler: number; target: { node: number; path: AnimationPath } }>;
}
interface GltfPrimitive { attributes: Record<string, number>; indices: number; }
interface GltfDocument {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  nodes: GltfNode[];
  meshes: Array<{ primitives: GltfPrimitive[] }>;
  skins: Array<{ inverseBindMatrices: number; joints: number[] }>;
  animations: GltfAnimation[];
}

interface ParsedGlb { json: GltfDocument; binary: ArrayBuffer; }
interface Track {
  node: number;
  path: AnimationPath;
  times: Float32Array;
  values: Float32Array;
  components: number;
  interpolation: 'LINEAR' | 'STEP';
}
interface Clip { name: string; start: number; duration: number; tracks: Track[]; }

export interface TankModel {
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly colors: GPUBuffer;
  readonly joints: GPUBuffer;
  readonly weights: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly indexCount: number;
  readonly resources: GPUBindGroup;
}

function parseGlb(bytes: ArrayBuffer): ParsedGlb {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Tank asset is not a glTF 2.0 binary');
  }
  let json: GltfDocument | undefined;
  let binary: ArrayBuffer | undefined;
  for (let offset = 12; offset < bytes.byteLength;) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === GLB_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, offset + 8, length))) as GltfDocument;
    } else if (type === GLB_BINARY) {
      binary = bytes.slice(offset + 8, offset + 8 + length);
    }
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error('Tank GLB is missing its JSON or binary data');
  return { json, binary };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readAccessor(glb: ParsedGlb, index: number): Float32Array {
  const accessor = glb.json.accessors[index];
  const bufferView = glb.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!components || !componentBytes) throw new Error(`Unsupported tank accessor ${accessor.type}/${accessor.componentType}`);
  const stride = bufferView.byteStride ?? components * componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = new DataView(glb.binary);
  const result = new Float32Array(accessor.count * components);
  const normalized = accessor.componentType === 5121 || accessor.componentType === 5123;
  const read = accessor.componentType === 5126 ? (offset: number) => source.getFloat32(offset, true)
    : accessor.componentType === 5125 ? (offset: number) => source.getUint32(offset, true)
      : accessor.componentType === 5123 ? (offset: number) => source.getUint16(offset, true)
        : accessor.componentType === 5122 ? (offset: number) => source.getInt16(offset, true)
          : accessor.componentType === 5121 ? (offset: number) => source.getUint8(offset)
            : (offset: number) => source.getInt8(offset);
  const max = accessor.componentType === 5121 ? 255 : accessor.componentType === 5123 ? 65535 : 1;
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      const value = read(start + item * stride + component * componentBytes);
      result[item * components + component] = normalized ? value / max : value;
    }
  }
  return result;
}

function readUint8Accessor(glb: ParsedGlb, index: number): Uint8Array {
  const accessor = glb.json.accessors[index];
  const bufferView = glb.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const stride = bufferView.byteStride ?? components * componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = new DataView(glb.binary);
  const result = new Uint8Array(accessor.count * components);
  const read = accessor.componentType === 5121 ? (offset: number) => source.getUint8(offset)
    : (offset: number) => source.getUint16(offset, true);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      result[item * components + component] = read(start + item * stride + component * componentBytes);
    }
  }
  return result;
}

function readIndices(glb: ParsedGlb, index: number): Float64Array {
  const accessor = glb.json.accessors[index];
  if (accessor.componentType !== 5123 && accessor.componentType !== 5125) {
    throw new Error(`Unsupported tank index component type ${accessor.componentType}`);
  }
  return readAccessorRaw(glb, index);
}

/** Like readAccessor but never normalizes integer values (used for indices/joints). */
function readAccessorRaw(glb: ParsedGlb, index: number): Float64Array {
  const accessor = glb.json.accessors[index];
  const bufferView = glb.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const stride = bufferView.byteStride ?? components * componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = new DataView(glb.binary);
  const result = new Float64Array(accessor.count * components);
  const read = accessor.componentType === 5125 ? (offset: number) => source.getUint32(offset, true)
    : (offset: number) => source.getUint16(offset, true);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      result[item * components + component] = read(start + item * stride + component * componentBytes);
    }
  }
  return result;
}

function uploadBuffer(device: GPUDevice, label: string, data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
  const paddedLength = align4(data.byteLength);
  const buffer = device.createBuffer({ label, size: paddedLength, usage: usage | GPUBufferUsage.COPY_DST });
  if (paddedLength === data.byteLength) {
    device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  } else {
    const padded = new Uint8Array(paddedLength);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, padded);
  }
  return buffer;
}

function animationClip(glb: ParsedGlb, name: string): Clip {
  const animation = glb.json.animations.find((candidate) => candidate.name?.endsWith(`|${name}`) || candidate.name === name);
  if (!animation) throw new Error(`Tank asset is missing ${name}`);
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const tracks = animation.channels.map((channel): Track => {
    const sampler = animation.samplers[channel.sampler];
    const interpolation = sampler.interpolation ?? 'LINEAR';
    if (interpolation !== 'LINEAR' && interpolation !== 'STEP') {
      throw new Error(`${name} uses unsupported ${interpolation} interpolation`);
    }
    const times = readAccessor(glb, sampler.input);
    const values = readAccessor(glb, sampler.output);
    start = Math.min(start, times[0]);
    end = Math.max(end, times[times.length - 1]);
    return {
      node: channel.target.node,
      path: channel.target.path,
      times,
      values,
      components: channel.target.path === 'rotation' ? 4 : 3,
      interpolation,
    };
  });
  return { name, start, duration: Math.max(1 / ANIMATION_FPS, end - start), tracks };
}

function sampleTrack(track: Track, time: number, target: vec3 | quat): void {
  let upper = 1;
  while (upper < track.times.length && track.times[upper] <= time) upper += 1;
  const right = Math.min(track.times.length - 1, upper);
  const left = Math.max(0, right - 1);
  const span = track.times[right] - track.times[left];
  const blend = track.interpolation === 'STEP' ? 0
    : span > 0 ? Math.max(0, Math.min(1, (time - track.times[left]) / span)) : 0;
  const a = left * track.components;
  const b = right * track.components;
  if (track.path === 'rotation') {
    const qa = quat.fromValues(track.values[a], track.values[a + 1], track.values[a + 2], track.values[a + 3]);
    const qb = quat.fromValues(track.values[b], track.values[b + 1], track.values[b + 2], track.values[b + 3]);
    const result = quat.slerp(quat.create(), qa, qb, blend);
    for (let component = 0; component < 4; component += 1) target[component] = result[component];
  } else {
    for (let component = 0; component < track.components; component += 1) {
      target[component] = track.values[a + component] * (1 - blend) + track.values[b + component] * blend;
    }
  }
}

/**
 * Combined vertex data across every mesh node in the file. The hull and
 * tracks are already skinned in the source; the gun and turret are static
 * (no skin) so their vertices are baked into world-bind space here and bound
 * rigidly (full weight) to the Root joint — they then ride along with the
 * hull through ordinary GPU skinning with no extra shader path.
 */
interface CombinedMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  joints: Uint8Array;
  weights: Float32Array;
  indices: Uint16Array;
}

function nodeLocalMatrix(node: GltfNode): mat4 {
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  return mat4.fromRotationTranslationScale(mat4.create(), r as quat, t as vec3, s as vec3);
}

function combineMeshNodes(glb: ParsedGlb, rootJointIndex: number): CombinedMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  let vertexBase = 0;

  glb.json.nodes.forEach((node) => {
    if (node.mesh === undefined) return;
    const mesh = glb.json.meshes[node.mesh];
    const rigid = node.skin === undefined;
    const localMatrix = rigid ? nodeLocalMatrix(node) : null;
    const normalMatrix = localMatrix ? mat4.invert(mat4.create(), localMatrix) : null;

    for (const primitive of mesh.primitives) {
      const primitivePositions = readAccessor(glb, primitive.attributes.POSITION);
      const primitiveNormals = readAccessor(glb, primitive.attributes.NORMAL);
      const vertexCount = primitivePositions.length / 3;
      const primitiveColors = primitive.attributes.COLOR_0 !== undefined
        ? readAccessor(glb, primitive.attributes.COLOR_0) : null;
      const primitiveJoints = primitive.attributes.JOINTS_0 !== undefined
        ? readUint8Accessor(glb, primitive.attributes.JOINTS_0) : null;
      const primitiveWeights = primitive.attributes.WEIGHTS_0 !== undefined
        ? readAccessor(glb, primitive.attributes.WEIGHTS_0) : null;
      const primitiveIndices = readIndices(glb, primitive.indices);

      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        let px = primitivePositions[vertex * 3];
        let py = primitivePositions[vertex * 3 + 1];
        let pz = primitivePositions[vertex * 3 + 2];
        let nx = primitiveNormals[vertex * 3];
        let ny = primitiveNormals[vertex * 3 + 1];
        let nz = primitiveNormals[vertex * 3 + 2];
        if (localMatrix) {
          const p = vec3.transformMat4(vec3.create(), [px, py, pz], localMatrix);
          [px, py, pz] = p;
          // Transform normals by the inverse-transpose so a non-uniform scale
          // (none present today, but this keeps the bake generally correct)
          // does not skew shading.
          const n = vec3.transformMat4(vec3.create(), [nx, ny, nz], normalMatrix!);
          vec3.normalize(n, n);
          [nx, ny, nz] = n;
        }
        positions.push(px, py, pz);
        normals.push(nx, ny, nz);
        if (primitiveColors) {
          const stride = primitiveColors.length / vertexCount;
          colors.push(
            primitiveColors[vertex * stride], primitiveColors[vertex * stride + 1],
            primitiveColors[vertex * stride + 2], stride > 3 ? primitiveColors[vertex * stride + 3] : 1,
          );
        } else {
          colors.push(0.82, 0.82, 0.82, 1);
        }
        if (primitiveJoints && primitiveWeights) {
          joints.push(
            primitiveJoints[vertex * 4], primitiveJoints[vertex * 4 + 1],
            primitiveJoints[vertex * 4 + 2], primitiveJoints[vertex * 4 + 3],
          );
          weights.push(
            primitiveWeights[vertex * 4], primitiveWeights[vertex * 4 + 1],
            primitiveWeights[vertex * 4 + 2], primitiveWeights[vertex * 4 + 3],
          );
        } else {
          // Rigid part: bound entirely to Root, so it rides the hull exactly.
          joints.push(rootJointIndex, 0, 0, 0);
          weights.push(1, 0, 0, 0);
        }
      }
      for (const value of primitiveIndices) indices.push(value + vertexBase);
      vertexBase += vertexCount;
    }
  });

  if (vertexBase > 65535) throw new Error(`Tank mesh has ${vertexBase} vertices; uint16 indices need <= 65535`);
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
    joints: Uint8Array.from(joints),
    weights: Float32Array.from(weights),
    indices: Uint16Array.from(indices),
  };
}

function bakePalettes(glb: ParsedGlb): { matrices: Float32Array; metadata: Uint32Array; rootJointIndex: number } {
  const skin = glb.json.skins[0];
  const jointCount = skin.joints.length;
  const rootJointIndex = skin.joints.findIndex((node) => glb.json.nodes[node].name === ROOT_BONE_NAME);
  if (rootJointIndex < 0) throw new Error(`Tank asset has no "${ROOT_BONE_NAME}" joint to neutralize root motion`);
  const inverseBindValues = readAccessor(glb, skin.inverseBindMatrices);
  const inverseBind = Array.from({ length: jointCount }, (_, index) => {
    const result = mat4.create();
    for (let component = 0; component < 16; component += 1) {
      result[component] = inverseBindValues[index * 16 + component];
    }
    return result;
  });
  const parent = new Int32Array(glb.json.nodes.length).fill(-1);
  glb.json.nodes.forEach((node, nodeIndex) => node.children?.forEach((child) => { parent[child] = nodeIndex; }));
  const clips = new Map(REQUIRED_CLIPS.map((name) => [name, animationClip(glb, name)]));
  const forward = clips.get('Tank_Forward')!;
  const backward = clips.get('Tank_Backwards')!;
  const states = [
    { clip: forward, frames: 1 },
    { clip: forward, frames: Math.max(1, Math.ceil(forward.duration * ANIMATION_FPS)) },
    { clip: backward, frames: Math.max(1, Math.ceil(backward.duration * ANIMATION_FPS)) },
  ];
  const totalFrames = states.reduce((sum, state) => sum + state.frames, 0);
  const matrices = new Float32Array(totalFrames * jointCount * 16);
  const metadata = new Uint32Array(16);
  const rootNode = skin.joints[rootJointIndex];
  const baseTranslations = glb.json.nodes.map((node) => vec3.fromValues(...(node.translation ?? [0, 0, 0])));
  const baseRotations = glb.json.nodes.map((node) => quat.fromValues(...(node.rotation ?? [0, 0, 0, 1])));
  const baseScales = glb.json.nodes.map((node) => vec3.fromValues(...(node.scale ?? [1, 1, 1])));
  const translations = baseTranslations.map((value) => vec3.clone(value));
  const rotations = baseRotations.map((value) => quat.clone(value));
  const scales = baseScales.map((value) => vec3.clone(value));
  const local = glb.json.nodes.map(() => mat4.create());
  const global = glb.json.nodes.map(() => mat4.create());
  const resolved = new Uint8Array(glb.json.nodes.length);
  const paletteMatrix = mat4.create();
  let frameOffset = 0;

  const resolveGlobal = (node: number): mat4 => {
    if (resolved[node]) return global[node];
    const ancestor = parent[node];
    if (ancestor >= 0) mat4.multiply(global[node], resolveGlobal(ancestor), local[node]);
    else mat4.copy(global[node], local[node]);
    resolved[node] = 1;
    return global[node];
  };

  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const state = states[stateIndex];
    metadata[stateIndex * 4] = frameOffset;
    metadata[stateIndex * 4 + 1] = state.frames;
    metadata[stateIndex * 4 + 2] = ANIMATION_FPS;
    for (let frame = 0; frame < state.frames; frame += 1) {
      translations.forEach((value, index) => vec3.copy(value, baseTranslations[index] as ReadonlyVec3));
      rotations.forEach((value, index) => quat.copy(value, baseRotations[index]));
      scales.forEach((value, index) => vec3.copy(value, baseScales[index] as ReadonlyVec3));
      const time = state.clip.start + (state.frames === 1 ? 0 : frame / ANIMATION_FPS);
      for (const track of state.clip.tracks) {
        // The whole-vehicle yaw/position this rig bakes into the Root track is
        // redundant with (and would double up on) the heading/position the
        // game already drives the marker with — keep Root at its bind pose so
        // only the track links animate.
        if (track.node === rootNode) continue;
        const target = track.path === 'translation' ? translations[track.node]
          : track.path === 'rotation' ? rotations[track.node] : scales[track.node];
        sampleTrack(track, time, target);
      }
      glb.json.nodes.forEach((_, index) => mat4.fromRotationTranslationScale(local[index], rotations[index], translations[index], scales[index]));
      resolved.fill(0);
      glb.json.nodes.forEach((_, index) => resolveGlobal(index));
      for (let joint = 0; joint < jointCount; joint += 1) {
        mat4.multiply(paletteMatrix, global[skin.joints[joint]], inverseBind[joint]);
        matrices.set(paletteMatrix, (frameOffset * jointCount + joint) * 16);
      }
      frameOffset += 1;
    }
  }
  metadata[12] = jointCount;
  return { matrices, metadata, rootJointIndex };
}

export async function loadTankModel(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  url: string,
): Promise<TankModel> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const glb = parseGlb(await response.arrayBuffer());
  const palettes = bakePalettes(glb);
  const mesh = combineMeshNodes(glb, palettes.rootJointIndex);
  const animationBuffer = uploadBuffer(device, 'tank animation palettes', palettes.matrices, GPUBufferUsage.STORAGE);
  const animationParams = uploadBuffer(device, 'tank animation metadata', palettes.metadata, GPUBufferUsage.UNIFORM);
  const resources = device.createBindGroup({
    label: 'tank model resources',
    layout,
    entries: [
      { binding: 0, resource: { buffer: animationBuffer } },
      { binding: 1, resource: { buffer: animationParams } },
    ],
  });
  return {
    positions: uploadBuffer(device, 'tank positions', mesh.positions, GPUBufferUsage.VERTEX),
    normals: uploadBuffer(device, 'tank normals', mesh.normals, GPUBufferUsage.VERTEX),
    colors: uploadBuffer(device, 'tank colors', mesh.colors, GPUBufferUsage.VERTEX),
    joints: uploadBuffer(device, 'tank joints', mesh.joints, GPUBufferUsage.VERTEX),
    weights: uploadBuffer(device, 'tank weights', mesh.weights, GPUBufferUsage.VERTEX),
    indices: uploadBuffer(device, 'tank indices', mesh.indices, GPUBufferUsage.INDEX),
    indexCount: mesh.indices.length,
    resources,
  };
}
