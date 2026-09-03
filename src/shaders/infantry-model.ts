import { commonWgsl } from './common';

/** Skinned, textured infantry model. Animation palettes are baked from the GLB at load time. */
export const infantryModelShader = commonWgsl + /* wgsl */ `
struct ArmyModel { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
struct ArmyModelParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyModels: array<ArmyModel>;
@group(1) @binding(1) var<uniform> armyModelParams: ArmyModelParams;

struct InfantryAnimationParams {
  clips: array<vec4u, 5>,
  jointCount: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};
@group(2) @binding(0) var<storage, read> animationFrames: array<mat4x4f>;
@group(2) @binding(1) var<uniform> animationParams: InfantryAnimationParams;
@group(2) @binding(2) var infantryBaseColor: texture_2d<f32>;
@group(2) @binding(3) var infantrySampler: sampler;

fn unpackInfantryRgb(packed: f32) -> vec3f {
  let value = u32(packed + 0.5);
  return vec3f(f32((value >> 16u) & 255u), f32((value >> 8u) & 255u), f32(value & 255u)) / 255.0;
}

struct InfantryOut {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) uv: vec2f,
  @location(2) ownerColor: vec3f,
  @location(3) alpha: f32,
  @location(4) @interpolate(flat) selected: f32,
  @location(5) worldPosition: vec3f,
};

@vertex
fn infantryModelVertex(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints: vec4u,
  @location(4) weights: vec4f,
  @builtin(instance_index) instanceIndex: u32,
) -> InfantryOut {
  let copyIndex = instanceIndex / armyModelParams.count;
  let model = armyModels[instanceIndex % armyModelParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let flags = u32(model.b.z + 0.5);
  let moving = (flags & 2u) != 0u;
  let retreating = (flags & 4u) != 0u;
  var state = 0u; // stationary pose from Walking
  if (retreating) {
    state = 3u; // Injured_Walk_Backward
  } else if (moving) {
    state = select(1u, 2u, model.b.y < 0.3); // Walking / Injured_Walk
  } else if (model.b.y < 0.3) {
    state = 4u; // stationary pose from Injured_Walk
  }
  let clip = animationParams.clips[state];
  let phase = fract(sin(dot(model.a.xy, vec2f(0.01371, 0.01993))) * 43758.5453);
  let frame = u32(floor(uniforms.sunTime.w * f32(clip.z) + phase * f32(clip.y))) % max(1u, clip.y);
  let palette = (clip.x + frame) * animationParams.jointCount;
  let skin = animationFrames[palette + joints.x] * weights.x
    + animationFrames[palette + joints.y] * weights.y
    + animationFrames[palette + joints.z] * weights.z
    + animationFrames[palette + joints.w] * weights.w;
  let skinnedPosition = skin * vec4f(position, 1.0);
  let skinnedNormal = normalize((skin * vec4f(normal, 0.0)).xyz);

  let motion = smoothstep(0.0, 1.0, (uniforms.sunTime.w - model.c.z) / 0.42);
  var headingDelta = model.b.w - model.c.w;
  headingDelta -= 6.2831853 * round(headingDelta / 6.2831853);
  let heading = model.c.w + headingDelta * motion;
  let cosine = cos(heading);
  let sine = sin(heading);
  // The source is 1.7 m tall. Match the strategic scale of the other close-range models.
  let scale = 3.0;
  // glTF character forward is +Z; map heading zero points north (-Z).
  let local = vec3f(skinnedPosition.x, skinnedPosition.y, -skinnedPosition.z) * scale;
  let localNormal = vec3f(skinnedNormal.x, skinnedNormal.y, -skinnedNormal.z);
  let rotated = vec3f(local.x * cosine - local.z * sine, local.y, local.x * sine + local.z * cosine);
  let rotatedNormal = normalize(vec3f(
    localNormal.x * cosine - localNormal.z * sine,
    localNormal.y,
    localNormal.x * sine + localNormal.z * cosine,
  ));
  let travel = select(0.0, clamp((uniforms.sunTime.w - model.d.w) / max(model.d.z, 0.0001), 0.0, 1.0), model.d.z > 0.0);
  let centerXZ = mix(model.a.xy, model.d.xy, travel) + vec2f(copyOffset, 0.0);
  let ground = heightAt(centerXZ / uniforms.map.xy);
  let worldPosition = vec3f(centerXZ.x + rotated.x, ground + rotated.y + 0.12, centerXZ.y + rotated.z);
  var output: InfantryOut;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.normal = rotatedNormal;
  output.uv = uv;
  output.ownerColor = unpackInfantryRgb(model.a.z);
  output.alpha = (1.0 - smoothstep(1500.0, 1900.0, uniforms.interaction.y))
    * (1.0 - horizontalWorldFog(worldPosition.x));
  output.selected = f32(flags & 1u);
  output.worldPosition = worldPosition;
  return output;
}

@fragment
fn infantryModelFragment(input: InfantryOut) -> @location(0) vec4f {
  let texel = textureSample(infantryBaseColor, infantrySampler, input.uv);
  if (texel.a < 0.1 || input.alpha < 0.01) { discard; }
  let ownerTint = mix(vec3f(1.0), input.ownerColor * 1.25, 0.18);
  var color = texel.rgb * ownerTint * surfaceLight(input.normal);
  color += wetSurfaceSheen(input.normal, input.worldPosition) * texel.rgb;
  if (input.selected > 0.5) { color = mix(color, vec3f(1.0, 0.84, 0.40), 0.24); }
  return vec4f(color, texel.a * input.alpha);
}
`;
