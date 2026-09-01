import { commonWgsl } from './common';

/** Procedural close-range army models plus their screen-facing per-kind counters. */
export const armyModelShader = commonWgsl + /* wgsl */ `
struct ArmyModel { a: vec4f, b: vec4f, c: vec4f };
struct ArmyModelParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyModels: array<ArmyModel>;
@group(1) @binding(1) var<uniform> armyModelParams: ArmyModelParams;

fn unpackModelRgb(packed: f32) -> vec3f {
  let v = u32(packed + 0.5);
  return vec3f(f32((v >> 16u) & 255u), f32((v >> 8u) & 255u), f32(v & 255u)) / 255.0;
}

struct CubePoint { position: vec3f, normal: vec3f };
fn cubePoint(vertex: u32) -> CubePoint {
  let triangle = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let face = vertex / 6u;
  let q = triangle[vertex % 6u];
  var point = vec3f(0.0);
  var normal = vec3f(0.0, 1.0, 0.0);
  switch face {
    case 0u: { point = vec3f(1.0, q.y, q.x); normal = vec3f(1.0, 0.0, 0.0); }
    case 1u: { point = vec3f(-1.0, q.y, -q.x); normal = vec3f(-1.0, 0.0, 0.0); }
    case 2u: { point = vec3f(q.x, 1.0, q.y); normal = vec3f(0.0, 1.0, 0.0); }
    case 3u: { point = vec3f(q.x, -1.0, -q.y); normal = vec3f(0.0, -1.0, 0.0); }
    case 4u: { point = vec3f(q.x, q.y, 1.0); normal = vec3f(0.0, 0.0, 1.0); }
    default: { point = vec3f(-q.x, q.y, -1.0); normal = vec3f(0.0, 0.0, -1.0); }
  }
  return CubePoint(point, normal);
}

struct ModelPart { center: vec3f, halfSize: vec3f, shade: f32 };
fn modelPart(kind: u32, part: u32) -> ModelPart {
  var center = vec3f(0.0);
  var halfSize = vec3f(0.01);
  var shade = 0.8;
  if (kind == 0u) {
    // Infantry: head, torso, two legs, arm and rifle.
    switch part {
      case 0u: { center = vec3f(0.0, 2.55, 0.0); halfSize = vec3f(0.34); shade = 1.2; }
      case 1u: { center = vec3f(0.0, 1.65, 0.0); halfSize = vec3f(0.46, 0.62, 0.30); shade = 0.78; }
      case 2u: { center = vec3f(-0.20, 0.65, 0.0); halfSize = vec3f(0.16, 0.62, 0.18); shade = 0.58; }
      case 3u: { center = vec3f(0.20, 0.65, 0.0); halfSize = vec3f(0.16, 0.62, 0.18); shade = 0.58; }
      case 4u: { center = vec3f(0.52, 1.75, 0.0); halfSize = vec3f(0.42, 0.13, 0.14); shade = 0.9; }
      default: { center = vec3f(0.80, 1.72, 0.0); halfSize = vec3f(0.72, 0.07, 0.07); shade = 0.35; }
    }
  } else if (kind == 1u) {
    // Light armor: compact tank silhouette shared by cars and light tanks.
    switch part {
      case 0u: { center = vec3f(0.0, 0.72, 0.0); halfSize = vec3f(1.65, 0.46, 1.12); shade = 0.72; }
      case 1u: { center = vec3f(0.0, 1.35, 0.0); halfSize = vec3f(0.82, 0.34, 0.72); shade = 0.92; }
      case 2u: { center = vec3f(0.0, 1.42, -1.36); halfSize = vec3f(0.13, 0.13, 0.88); shade = 0.40; }
      case 3u: { center = vec3f(-1.48, 0.46, 0.0); halfSize = vec3f(0.28, 0.34, 1.22); shade = 0.34; }
      case 4u: { center = vec3f(1.48, 0.46, 0.0); halfSize = vec3f(0.28, 0.34, 1.22); shade = 0.34; }
      default: { center = vec3f(0.0, 1.82, 0.12); halfSize = vec3f(0.28, 0.14, 0.28); shade = 1.05; }
    }
  } else if (kind == 2u) {
    // Heavy armor: broader medium-tank hull, turret, cannon and tracks.
    switch part {
      case 0u: { center = vec3f(0.0, 0.78, 0.0); halfSize = vec3f(1.88, 0.52, 1.28); shade = 0.62; }
      case 1u: { center = vec3f(0.0, 1.52, 0.0); halfSize = vec3f(1.02, 0.42, 0.88); shade = 0.88; }
      case 2u: { center = vec3f(0.0, 1.58, -1.62); halfSize = vec3f(0.16, 0.16, 1.10); shade = 0.34; }
      case 3u: { center = vec3f(-1.66, 0.48, 0.0); halfSize = vec3f(0.32, 0.38, 1.38); shade = 0.26; }
      case 4u: { center = vec3f(1.66, 0.48, 0.0); halfSize = vec3f(0.32, 0.38, 1.38); shade = 0.26; }
      default: { center = vec3f(0.0, 2.02, 0.12); halfSize = vec3f(0.32, 0.16, 0.32); shade = 1.0; }
    }
  } else {
    // Artillery: carriage, shield, long barrel, trail and wheels.
    switch part {
      case 0u: { center = vec3f(0.0, 0.66, 0.0); halfSize = vec3f(0.78, 0.22, 0.86); shade = 0.64; }
      case 1u: { center = vec3f(0.0, 1.18, -0.32); halfSize = vec3f(0.92, 0.58, 0.12); shade = 0.88; }
      case 2u: { center = vec3f(0.0, 1.38, -1.25); halfSize = vec3f(0.13, 0.13, 1.18); shade = 0.44; }
      case 3u: { center = vec3f(0.0, 0.34, 1.34); halfSize = vec3f(0.20, 0.16, 1.12); shade = 0.52; }
      case 4u: { center = vec3f(-0.92, 0.58, 0.0); halfSize = vec3f(0.24, 0.58, 0.58); shade = 0.26; }
      default: { center = vec3f(0.92, 0.58, 0.0); halfSize = vec3f(0.24, 0.58, 0.58); shade = 0.26; }
    }
  }
  return ModelPart(center, halfSize, shade);
}

struct ModelOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
};

@vertex
fn armyModelVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> ModelOut {
  let copyIndex = instanceIndex / armyModelParams.count;
  let model = armyModels[instanceIndex % armyModelParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let kind = min(u32(model.a.w + 0.5), 3u);
  let partIndex = vertexIndex / 36u;
  let cube = cubePoint(vertexIndex % 36u);
  let part = modelPart(kind, partIndex);
  // Same 0.42s window used to slide the model between marker syncs also eases
  // the facing, along the shortest arc, from the pre-sync heading (c.w) to the
  // new one (b.w) — a road corner reads as a turn, not a snap.
  let motion = smoothstep(0.0, 1.0, (uniforms.sunTime.w - model.c.z) / 0.42);
  var headingDelta = model.b.w - model.c.w;
  headingDelta = headingDelta - 6.2831853 * round(headingDelta / 6.2831853);
  let heading = model.c.w + headingDelta * motion;
  let cosine = cos(heading);
  let sine = sin(heading);
  // Map-scale strategic units: kept deliberately small so roads, towns and the
  // movement path still read at strategic zoom. Selection/pick hitbox is on the
  // flat marker, not the model, so this does not hurt selectability. Trimmed
  // again this pass (1.95 -> 1.7) to sit closer to the road ribbon width.
  let scale = 1.7;
  let local = (part.center + cube.position * part.halfSize) * scale;
  let rotated = vec3f(local.x * cosine - local.z * sine, local.y, local.x * sine + local.z * cosine);
  let centerXZ = mix(model.c.xy, model.a.xy, motion) + vec2f(copyOffset, 0.0);
  let ground = heightAt(centerXZ / uniforms.map.xy);
  // Ground lift tracks model scale so shrinking the unit doesn't leave it hovering.
  let worldPosition = vec3f(centerXZ.x + rotated.x, ground + rotated.y + scale * 0.2, centerXZ.y + rotated.z);
  let normal = normalize(vec3f(cube.normal.x * cosine - cube.normal.z * sine, cube.normal.y, cube.normal.x * sine + cube.normal.z * cosine));
  var output: ModelOut;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.normal = normal;
  output.color = unpackModelRgb(model.a.z) * part.shade;
  let closeFade = 1.0 - smoothstep(1500.0, 1900.0, uniforms.interaction.y);
  output.alpha = closeFade * (1.0 - horizontalWorldFog(worldPosition.x));
  if (model.b.z > 0.5) { output.color = mix(output.color, vec3f(1.0, 0.84, 0.40), 0.24); }
  return output;
}

@fragment
fn armyModelFragment(input: ModelOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let light = 0.34 + max(dot(normalize(input.normal), normalize(vec3f(-0.45, 0.82, -0.34))), 0.0) * 0.66;
  return vec4f(input.color * light, input.alpha);
}

struct CountOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec3f,
  @location(2) @interpolate(flat) count: f32,
  @location(3) alpha: f32,
};

@vertex
fn armyKindCountVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> CountOut {
  let copyIndex = instanceIndex / armyModelParams.count;
  let model = armyModels[instanceIndex % armyModelParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let motion = smoothstep(0.0, 1.0, (uniforms.sunTime.w - model.c.z) / 0.42);
  let worldXZ = mix(model.c.xy, model.a.xy, motion) + vec2f(copyOffset, 0.0);
  let worldPosition = vec3f(worldXZ.x, heightAt(worldXZ / uniforms.map.xy) + 17.0, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  var output: CountOut;
  output.uv = corner;
  output.color = unpackModelRgb(model.a.z);
  output.count = model.b.x;
  output.alpha = (1.0 - smoothstep(1500.0, 1900.0, uniforms.interaction.y)) * (1.0 - horizontalWorldFog(worldPosition.x));
  let pixelCenter = vec2f(28.0, 1.0);
  let pixelOffset = (pixelCenter + corner * vec2f(13.0, 10.0)) * 2.0 / uniforms.viewport.xy;
  output.position = clip + vec4f(pixelOffset * clip.w, -0.0002 * clip.w, 0.0);
  return output;
}

fn countGlyphBit(glyph: i32, col: i32, row: i32) -> f32 {
  if (col < 0 || col > 2 || row < 0 || row > 4) { return 0.0; }
  var mask = 0u;
  switch glyph {
    case 0: { mask = 0x7B6Fu; } case 1: { mask = 0x2492u; }
    case 2: { mask = 0x73E7u; } case 3: { mask = 0x79E7u; }
    case 4: { mask = 0x49EDu; } case 5: { mask = 0x79CFu; }
    case 6: { mask = 0x7BCFu; } case 7: { mask = 0x24A7u; }
    case 8: { mask = 0x7BEFu; } default: { mask = 0x79EFu; }
  }
  return select(0.0, 1.0, (mask & (1u << u32(row * 3 + col))) != 0u);
}

fn countGlyph(glyph: i32, p: vec2f, offsetX: f32) -> f32 {
  let local = vec2f((p.x - offsetX) / 0.31, p.y / 0.55);
  if (abs(local.x) > 1.0 || abs(local.y) > 1.0) { return 0.0; }
  return countGlyphBit(glyph, i32(floor((local.x * 0.5 + 0.5) * 3.0)), i32(floor((0.5 - local.y * 0.5) * 5.0)));
}

@fragment
fn armyKindCountFragment(input: CountOut) -> @location(0) vec4f {
  if (input.alpha < 0.01 || abs(input.uv.x) > 0.94 || abs(input.uv.y) > 0.86) { discard; }
  let count = i32(clamp(input.count + 0.5, 1.0, 99.0));
  var glyph = 0.0;
  if (count < 10) {
    glyph = countGlyph(count, input.uv, 0.0);
  } else {
    glyph = countGlyph(count / 10, input.uv, -0.34) + countGlyph(count % 10, input.uv, 0.34);
  }
  let edge = max(abs(input.uv.x), abs(input.uv.y));
  let base = mix(vec3f(0.08, 0.09, 0.07), input.color * 0.42, smoothstep(0.3, 0.95, edge));
  return vec4f(mix(base, vec3f(0.98, 0.96, 0.86), clamp(glyph, 0.0, 1.0)), input.alpha * 0.96);
}
`;
