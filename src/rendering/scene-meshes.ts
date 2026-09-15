import { MeshBuilder } from './geometry';

export interface Mesh {
  vertex: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

const align4 = (value: number): number => (value + 3) & ~3;

export function createTerrainMesh(device: GPUDevice, resolution: number, skirts = false): Mesh {
  const vertexValues: number[] = [];
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      vertexValues.push(x / (resolution - 1), y / (resolution - 1), 0);
    }
  }
  const indexValues: number[] = [];
  for (let y = 0; y < resolution - 1; y += 1) {
    for (let x = 0; x < resolution - 1; x += 1) {
      const a = y * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indexValues.push(a, c, b, b, c, d);
    }
  }
  if (skirts) {
    const addSkirtSegment = (u1: number, v1: number, u2: number, v2: number): void => {
      const first = vertexValues.length / 3;
      vertexValues.push(u1, v1, 0, u2, v2, 0, u1, v1, 1, u2, v2, 1);
      indexValues.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
    };
    for (let index = 0; index < resolution - 1; index += 1) {
      const a = index / (resolution - 1);
      const b = (index + 1) / (resolution - 1);
      addSkirtSegment(a, 0, b, 0);
      addSkirtSegment(b, 1, a, 1);
      addSkirtSegment(0, b, 0, a);
      addSkirtSegment(1, a, 1, b);
    }
  }
  return uploadMesh(device, 'terrain grid', new Float32Array(vertexValues), new Uint16Array(indexValues));
}

export function createTreeFamilyMesh(device: GPUDevice, family: 'broadleaf' | 'conifer', lod: 0 | 1 | 2): Mesh {
  const builder = new MeshBuilder();
  if (lod < 2) builder.addBox(-0.5, 0, -0.5, 0.5, 1, 0.5, 0);
  const partCount = lod === 0 ? 3 : lod === 1 ? 2 : 1;
  if (family === 'broadleaf') {
    for (let part = 1; part <= partCount; part += 1) builder.addFacetedSphere(part);
  } else {
    for (let part = 4; part < 4 + partCount; part += 1) builder.addCone(0, -1, 0, 1, 1, lod === 2 ? 6 : 8, part);
  }
  return uploadMesh(device, `${family} tree lod ${lod}`, new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

/**
 * Each archetype gets a genuinely different footprint and height, not just a
 * different roof. From the game's high strategic camera, roof shape alone
 * reads as near-identical silhouettes at this scale; footprint and height
 * variety is what actually differentiates buildings from that angle.
 */
export function createBuildingArchetypeMesh(device: GPUDevice, archetype: number, lod: 0 | 1): Mesh {
  const builder = new MeshBuilder();
  if (archetype === 0) {
    // Small square cottage.
    builder.addBox(-0.42, 0, -0.42, 0.42, 0.82, 0.42, 0);
    builder.addGableRoof(-0.48, 0.82, -0.48, 0.48, lod === 0 ? 1.18 : 1.12, 0.48, 1);
  } else if (archetype === 1) {
    // Tall, narrow townhouse.
    builder.addBox(-0.34, 0, -0.44, 0.34, 1.32, 0.44, 0);
    builder.addHipRoof(0, 1.32, 0, 0.5, 1.62, 4);
  } else if (archetype === 2) {
    // Wide, low shop or warehouse with a flat roof and a slight parapet.
    // Kept within the +/-0.56 footprint scripts/world/instances.mjs assumes
    // for this archetype's coastal water-clearance check (see
    // ARCHETYPE_FOOTPRINT_HALF there) — going wider would need a world
    // rebuild to stay coastline-safe, which this change doesn't warrant.
    builder.addBox(-0.52, 0, -0.4, 0.52, 0.68, 0.4, 0);
    builder.addBox(-0.56, 0.68, -0.44, 0.56, 0.74, 0.44, 5, 5);
  } else if (archetype === 3) {
    // Larger building with a lean-to porch along one side.
    builder.addBox(-0.56, 0, -0.42, 0.56, 1.02, 0.42, 0);
    builder.addGableRoof(-0.62, 1.02, -0.48, 0.62, lod === 0 ? 1.28 : 1.2, 0.48, 1);
    if (lod === 0) builder.addBox(-0.7, 0, -0.36, 0.7, 0.4, 0.36, 2, 2);
  } else if (archetype === 4) {
    // Landmark archetype: this one gets much less of the map-scale shrink
    // (see BUILDING_FOOTPRINT_SCALE in shaders/props.ts), so it needs to read
    // as a substantial civic building, not just a tall narrow spire — a wide
    // base topped with a modest clock-tower flourish, rather than a thin
    // tower being the whole building. Uses the archetype's generous
    // LARGE_ARCHETYPE_COAST_SETBACK (3.0 world units) in instances.mjs, so a
    // wider-than-+/-0.5 footprint here still stays coastline-safe.
    // Material 1 (gable roof), not 4 (hip roof) — the fragment shader hides
    // material 4 for every archetype except 1 (see propFragment's opacity
    // gating), so a hip roof here would render invisible.
    builder.addBox(-0.58, 0, -0.5, 0.58, 1.05, 0.5, 0);
    builder.addGableRoof(-0.64, 1.05, -0.56, 0.64, lod === 0 ? 1.4 : 1.32, 0.56, 1);
    if (lod === 0) builder.addBox(-0.15, 1.4, -0.15, 0.15, 1.8, 0.15, 3, 3);
  } else if (archetype === 5) {
    // Chapel/church: a war-torn European town's most recognisable landmark
    // after the capital's civic building. Only materials 0 (wall) and 1
    // (roof) are used, same as every other non-4/non-3 archetype, so no
    // shader gating changes are needed. The spire is the whole point of this
    // archetype — at this game's fixed strategic camera a building's fine
    // detail never reads (verified: ~15-40px tall on screen even at minimum
    // zoom), so the differentiator has to be silhouette height, not geometry
    // count. instances.mjs gives this archetype a modest sy boost (1.15x) on
    // top of the spire's own tall local extent so it actually reads taller
    // than an ordinary building rather than blending in.
    builder.addBox(-0.32, 0, -0.46, 0.32, 1.05, 0.46, 0);
    builder.addGableRoof(-0.38, 1.05, -0.52, 0.38, lod === 0 ? 1.35 : 1.26, 0.52, 1);
    if (lod === 0) builder.addCone(0, 1.35, -0.30, 0.15, 2.0, 6, 1);
  } else if (archetype === 6) {
    // Industrial hall: wide, low, flat-roofed, with one or two chimneys — a
    // war-economy factory silhouette. No extra sy multiplier in
    // instances.mjs; the low wide box plus thin chimney pokes create the
    // distinct shape without fighting BUILDING_HEIGHT_SCALE.
    builder.addBox(-0.56, 0, -0.42, 0.56, 0.62, 0.42, 0);
    builder.addBox(-0.58, 0.62, -0.44, 0.58, 0.70, 0.44, 1, 1);
    if (lod === 0) {
      builder.addCone(-0.30, 0.70, 0.10, 0.05, 1.15, 8, 1);
      builder.addCone(0.15, 0.70, -0.10, 0.06, 1.32, 8, 1);
    }
  } else {
    // Ruins (archetype 7, final catch-all): a bombed-out shell — flat-topped,
    // roofless main block plus one asymmetric surviving wall stub, instead of
    // a clean gable. No extra sy multiplier: an earlier draft shrank this
    // archetype's height on top of the shared BUILDING_HEIGHT_SCALE
    // compression and worked out to a ~5px sliver at the game's minimum
    // camera distance — invisible, not "ruined". Keeping full height and
    // relying on the missing-roof/asymmetric-stub shape is what actually
    // reads at this scale.
    builder.addBox(-0.42, 0, -0.42, 0.42, 0.68, 0.42, 0);
    builder.addBox(-0.16, 0.68, -0.38, 0.20, 1.05, -0.10, 0);
  }
  return uploadMesh(device, `building archetype ${archetype} lod ${lod}`, new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createLampMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.07, 0, -0.07, 0.07, 3.2, 0.07, 0);
  builder.addBox(-0.10, 3.0, -0.10, 0.10, 3.42, 0.10, 0);
  builder.addBox(-0.18, 3.38, -0.18, 0.18, 3.57, 0.18, 1, 1);
  return uploadMesh(device,'road lamp mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createBarrierMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  for (const x of [-0.46, 0, 0.46]) builder.addBox(x - 0.025, 0, -0.07, x + 0.025, 0.86, 0.07, 0);
  builder.addBox(-0.5, 0.58, -0.055, 0.5, 0.72, 0.055, 1, 1);
  return uploadMesh(device,'road barrier mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

export function createSignMesh(device: GPUDevice): Mesh {
  const builder = new MeshBuilder();
  builder.addBox(-0.045, 0, -0.045, 0.045, 1.55, 0.045, 0);
  builder.addBox(-0.42, 1.08, -0.055, 0.42, 1.52, 0.055, 1, 1);
  return uploadMesh(device,'road sign mesh', new Float32Array(builder.vertices), new Uint16Array(builder.indices));
}

function uploadMesh(device: GPUDevice, label: string, vertices: Float32Array, indices: Uint16Array): Mesh {
  const vertex = device.createBuffer({ label: `${label} vertices`, size: align4(vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const index = device.createBuffer({ label: `${label} indices`, size: align4(indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertex, 0, vertices.buffer as ArrayBuffer, vertices.byteOffset, vertices.byteLength);
  device.queue.writeBuffer(index, 0, indices.buffer as ArrayBuffer, indices.byteOffset, indices.byteLength);
  return { vertex, index, indexCount: indices.length };
}

export function uploadIndexedMesh(device: GPUDevice, label: string, vertexData: ArrayBuffer, indexData: ArrayBuffer, indexCount: number): Mesh {
  const vertex = device.createBuffer({ label: `${label} vertices`, size: align4(vertexData.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const index = device.createBuffer({ label: `${label} indices`, size: align4(indexData.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vertex, 0, vertexData);
  device.queue.writeBuffer(index, 0, indexData);
  return { vertex, index, indexCount };
}
