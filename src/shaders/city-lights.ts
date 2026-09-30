import { commonWgsl } from './common';

export const cityLightShader = commonWgsl + /* wgsl */ `
struct InstanceRecord { a: vec4f, b: vec4f };
struct InstanceParams { count: u32, kind: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> instances: array<InstanceRecord>;
@group(1) @binding(1) var<uniform> instanceParams: InstanceParams;
@group(1) @binding(2) var<storage, read> visibleInstances: array<u32>;

struct CityLightOutput {
  @builtin(position) position: vec4f,
  @location(0) glowUv: vec2f,
  @location(1) color: vec3f,
  @location(2) opacity: f32,
};

@vertex
fn cityLightVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> CityLightOutput {
  let count = instanceParams.count;
  let visibleInstance = visibleInstances[instanceIndex];
  let copyIndex = visibleInstance / count;
  let record = instances[visibleInstance % count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let worldX = record.a.x + copyOffset;
  let mapUv = vec2f(record.a.x / uniforms.map.x, record.a.y / uniforms.map.y);
  let worldPosition = vec3f(worldX, heightAt(mapUv) + record.a.w * 1.18 + 1.2, record.a.y);
  let clip = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let cameraDistance = distance(uniforms.camera.xyz, worldPosition);
  let strategicFade = smoothstep(1850.0, 2650.0, cameraDistance);
  let darkness = max(uniforms.lighting.z, uniforms.lighting.y * 0.32);
  let seed = noiseHash(floor(record.a.xy * 0.113));
  let sizePixels = mix(0.72, 1.42, seed);
  let pixelOffset = corner * sizePixels * 2.0 / uniforms.viewport.xy;

  var output: CityLightOutput;
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  output.glowUv = corner;
  output.color = mix(vec3f(1.0, 0.43, 0.10), vec3f(1.0, 0.78, 0.35), seed);
  output.opacity = strategicFade * darkness * (1.0 - mapFog(worldPosition.xz)) * mix(0.48, 0.90, seed);
  return output;
}

@fragment
fn cityLightFragment(input: CityLightOutput) -> @location(0) vec4f {
  let radius = length(input.glowUv);
  let halo = 1.0 - smoothstep(0.16, 1.0, radius);
  let core = 1.0 - smoothstep(0.0, 0.30, radius);
  let alpha = input.opacity * (halo * 0.42 + core * 0.58);
  if (alpha < 0.008) { discard; }
  return vec4f(input.color * (0.86 + core * 0.34), alpha);
}
`;
