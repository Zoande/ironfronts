import { mat4, quat, vec3, type ReadonlyVec3 } from 'gl-matrix';
import { align4 } from './gpu-utils';

const GLB_JSON = 0x4e4f534a;
const GLB_BINARY = 0x004e4942;
const ANIMATION_FPS = 30;
const REQUIRED_CLIPS = ['Walking', 'Injured_Walk', 'Injured_Walk_Backward'] as const;

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
interface GltfDocument {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  nodes: GltfNode[];
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
  skins: Array<{ inverseBindMatrices: number; joints: number[] }>;
  animations: GltfAnimation[];
  images: Array<{ bufferView: number; mimeType?: string }>;
  textures?: Array<{ source?: number }>;
  materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
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

export interface InfantryModel {
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly texcoords: GPUBuffer;
  readonly joints: GPUBuffer;
  readonly weights: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly indexCount: number;
  readonly resources: GPUBindGroup;
}

function parseGlb(bytes: ArrayBuffer): ParsedGlb {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Infantry asset is not a glTF 2.0 binary');
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
  if (!json || !binary) throw new Error('Infantry GLB is missing its JSON or binary data');
  return { json, binary };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readAccessor(glb: ParsedGlb, index: number): Float32Array {
  const accessor = glb.json.accessors[index];
  const bufferView = glb.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!components || !componentBytes) throw new Error(`Unsupported infantry accessor ${accessor.type}/${accessor.componentType}`);
  const stride = bufferView.byteStride ?? components * componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const source = new DataView(glb.binary);
  const result = new Float32Array(accessor.count * components);
  const read = accessor.componentType === 5126 ? (offset: number) => source.getFloat32(offset, true)
    : accessor.componentType === 5125 ? (offset: number) => source.getUint32(offset, true)
      : accessor.componentType === 5123 ? (offset: number) => source.getUint16(offset, true)
        : accessor.componentType === 5122 ? (offset: number) => source.getInt16(offset, true)
          : accessor.componentType === 5121 ? (offset: number) => source.getUint8(offset)
            : (offset: number) => source.getInt8(offset);
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < components; component += 1) {
      result[item * components + component] = read(start + item * stride + component * componentBytes);
    }
  }
  return result;
}

function readUint8Accessor(glb: ParsedGlb, index: number): Uint8Array {
  const values = readAccessor(glb, index);
  return Uint8Array.from(values);
}

function readUint16Accessor(glb: ParsedGlb, index: number): Uint16Array {
  const accessor = glb.json.accessors[index];
  if (accessor.componentType !== 5123) throw new Error('Infantry indices must be uint16');
  return Uint16Array.from(readAccessor(glb, index));
}

function uploadBuffer(device: GPUDevice, label: string, data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer {
  const paddedLength = align4(data.byteLength);
  const buffer = device.createBuffer({ label, size: paddedLength, usage: usage | GPUBufferUsage.COPY_DST });
  if (paddedLength === data.byteLength) {
    device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  } else {
    // WebGPU queue writes must be 4-byte sized even when a valid uint16 index
    // stream naturally ends on a 2-byte boundary.
    const padded = new Uint8Array(paddedLength);
    padded.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    device.queue.writeBuffer(buffer, 0, padded);
  }
  return buffer;
}

function animationClip(glb: ParsedGlb, name: string): Clip {
  const animation = glb.json.animations.find((candidate) => candidate.name === name);
  if (!animation) throw new Error(`Infantry asset is missing ${name}`);
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

function bakePalettes(glb: ParsedGlb): { matrices: Float32Array; metadata: Uint32Array } {
  const skin = glb.json.skins[0];
  const jointCount = skin.joints.length;
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
  const meshNode = glb.json.nodes.findIndex((node) => node.mesh !== undefined && node.skin !== undefined);
  if (meshNode < 0) throw new Error('Infantry asset has no skinned mesh node');
  const clips = new Map(REQUIRED_CLIPS.map((name) => [name, animationClip(glb, name)]));
  const states = [
    { clip: clips.get('Walking')!, frames: 1 },
    { clip: clips.get('Walking')!, frames: Math.max(1, Math.ceil(clips.get('Walking')!.duration * ANIMATION_FPS)) },
    { clip: clips.get('Injured_Walk')!, frames: Math.max(1, Math.ceil(clips.get('Injured_Walk')!.duration * ANIMATION_FPS)) },
    { clip: clips.get('Injured_Walk_Backward')!, frames: Math.max(1, Math.ceil(clips.get('Injured_Walk_Backward')!.duration * ANIMATION_FPS)) },
    { clip: clips.get('Injured_Walk')!, frames: 1 },
  ];
  const totalFrames = states.reduce((sum, state) => sum + state.frames, 0);
  const matrices = new Float32Array(totalFrames * jointCount * 16);
  const metadata = new Uint32Array(24);
  const translations = glb.json.nodes.map((node) => vec3.fromValues(...(node.translation ?? [0, 0, 0])));
  const rotations = glb.json.nodes.map((node) => quat.fromValues(...(node.rotation ?? [0, 0, 0, 1])));
  const scales = glb.json.nodes.map((node) => vec3.fromValues(...(node.scale ?? [1, 1, 1])));
  const baseTranslations = translations.map((value) => vec3.clone(value));
  const baseRotations = rotations.map((value) => quat.clone(value));
  const baseScales = scales.map((value) => vec3.clone(value));
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
        const target = track.path === 'translation' ? translations[track.node]
          : track.path === 'rotation' ? rotations[track.node] : scales[track.node];
        sampleTrack(track, time, target);
        // These clips contain locomotion in the Hips track. The map marker owns
        // world movement, so retain vertical bob but remove horizontal root motion.
        if (track.node === skin.joints[0] && track.path === 'translation') {
          target[0] = track.values[0];
          target[2] = track.values[2];
        }
      }
      glb.json.nodes.forEach((_, index) => mat4.fromRotationTranslationScale(local[index], rotations[index], translations[index], scales[index]));
      resolved.fill(0);
      glb.json.nodes.forEach((_, index) => resolveGlobal(index));
      for (let joint = 0; joint < jointCount; joint += 1) {
        // glTF inverse-bind matrices are expressed in global armature space.
        // The source Armature's 0.01 conversion is already cancelled here;
        // applying inverse(meshGlobal) again would inflate the soldier 100x.
        mat4.multiply(paletteMatrix, global[skin.joints[joint]], inverseBind[joint]);
        matrices.set(paletteMatrix, (frameOffset * jointCount + joint) * 16);
      }
      frameOffset += 1;
    }
  }
  metadata[20] = jointCount;
  return { matrices, metadata };
}

async function uploadBaseColor(device: GPUDevice, glb: ParsedGlb): Promise<GPUTexture> {
  const materialTexture = glb.json.materials?.[0]?.pbrMetallicRoughness?.baseColorTexture?.index ?? 0;
  const imageIndex = glb.json.textures?.[materialTexture]?.source ?? 0;
  const image = glb.json.images[imageIndex];
  const view = glb.json.bufferViews[image.bufferView];
  const start = view.byteOffset ?? 0;
  const bitmap = await createImageBitmap(new Blob(
    [glb.binary.slice(start, start + view.byteLength)],
    { type: image.mimeType ?? 'image/png' },
  ));
  const texture = device.createTexture({
    label: 'infantry base color',
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
  bitmap.close();
  return texture;
}

export async function loadInfantryModel(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  url = '/models/infantry.glb',
): Promise<InfantryModel> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  const glb = parseGlb(await response.arrayBuffer());
  const primitive = glb.json.meshes[0]?.primitives[0];
  if (!primitive) throw new Error('Infantry asset contains no mesh primitive');
  const positions = readAccessor(glb, primitive.attributes.POSITION);
  const normals = readAccessor(glb, primitive.attributes.NORMAL);
  const texcoords = readAccessor(glb, primitive.attributes.TEXCOORD_0);
  const joints = readUint8Accessor(glb, primitive.attributes.JOINTS_0);
  const weights = readAccessor(glb, primitive.attributes.WEIGHTS_0);
  const indices = readUint16Accessor(glb, primitive.indices);
  const palettes = bakePalettes(glb);
  const baseColor = await uploadBaseColor(device, glb);
  const animationBuffer = uploadBuffer(device, 'infantry animation palettes', palettes.matrices, GPUBufferUsage.STORAGE);
  const animationParams = uploadBuffer(device, 'infantry animation metadata', palettes.metadata, GPUBufferUsage.UNIFORM);
  const resources = device.createBindGroup({
    label: 'infantry model resources',
    layout,
    entries: [
      { binding: 0, resource: { buffer: animationBuffer } },
      { binding: 1, resource: { buffer: animationParams } },
      { binding: 2, resource: baseColor.createView() },
      { binding: 3, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
    ],
  });
  return {
    positions: uploadBuffer(device, 'infantry positions', positions, GPUBufferUsage.VERTEX),
    normals: uploadBuffer(device, 'infantry normals', normals, GPUBufferUsage.VERTEX),
    texcoords: uploadBuffer(device, 'infantry texcoords', texcoords, GPUBufferUsage.VERTEX),
    joints: uploadBuffer(device, 'infantry joints', joints, GPUBufferUsage.VERTEX),
    weights: uploadBuffer(device, 'infantry weights', weights, GPUBufferUsage.VERTEX),
    indices: uploadBuffer(device, 'infantry indices', indices, GPUBufferUsage.INDEX),
    indexCount: indices.length,
    resources,
  };
}
