import { commonWgsl } from './common';

export const infrastructureShader = commonWgsl + /* wgsl */ `
struct InfrastructureInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) kind: f32,
};

struct InfrastructureOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) roadUv: vec2f,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) visibility: f32,
};

@vertex
fn infrastructureVertex(input: InfrastructureInput, @builtin(instance_index) instanceIndex: u32) -> InfrastructureOutput {
  let copyOffset = f32(i32(instanceIndex) - 1) * uniforms.map.x;
  let worldPosition = input.position + vec3f(copyOffset, 0.0, 0.0);
  let cameraDistance = distance(uniforms.camera.xyz, worldPosition);
  var output: InfrastructureOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.normal = input.normal;
  output.roadUv = input.roadUv;
  output.kind = input.kind;
  let geometryEnd = select(2200.0, 8000.0, input.kind > 0.5);
  output.visibility = 1.0 - smoothstep(geometryEnd - 650.0, geometryEnd, cameraDistance);
  return output;
}

@fragment
fn infrastructureFragment(input: InfrastructureOutput) -> @location(0) vec4f {
  if (input.visibility < 0.025) { discard; }
  let dotted = input.kind > 0.5;
  let mapUv = input.worldPosition.xz / uniforms.map.xy;
  if (!dotted && landAt(mapUv) < 0.52) { discard; }
  if (dotted && fract(input.roadUv.x / 6.4) > 0.40) { discard; }
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 8u || debugMode == 9u) {
    let worldFog = mapFog(input.worldPosition.xz);
    return vec4f(select(vec3f(0.98, 0.20, 0.07), vec3f(0.96, 0.78, 0.22), dotted), input.visibility * (1.0 - worldFog));
  }
  let grit = fract(sin(dot(floor(input.worldPosition.xz * 2.2), vec2f(12.9898, 78.233))) * 43758.5453);
  let rutA = 1.0 - smoothstep(0.045, 0.12, abs(input.roadUv.y - 0.43));
  let rutB = 1.0 - smoothstep(0.045, 0.12, abs(input.roadUv.y - 0.57));
  var color = mix(vec3f(0.36, 0.285, 0.17), vec3f(0.245, 0.19, 0.115), max(rutA, rutB) * 0.55) * (0.90 + grit * 0.16);
  if (dotted) { color = vec3f(0.96, 0.73, 0.25) * (0.94 + grit * 0.06); }
  color = mix(color, color * vec3f(0.69, 0.75, 0.78), uniforms.weather.x * 0.44);
  let normal = normalize(input.normal);
  let fog = smoothstep(3500.0, 11000.0, distance(uniforms.camera.xyz, input.worldPosition));
  let worldFog = mapFog(input.worldPosition.xz);
  color = mix(mix(color * surfaceLight(normal) + wetSurfaceSheen(normal, input.worldPosition), distanceFogColor(), fog * 0.39), worldFogColor(), worldFog);
  return vec4f(color, input.visibility * (1.0 - worldFog));
}
`;
