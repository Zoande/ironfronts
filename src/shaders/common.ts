import { WORLD_FOG_END_RATIO, WORLD_FOG_START_RATIO } from '../rendering/world-fog';

export const commonWgsl = /* wgsl */ `
struct Uniforms {
  viewProjection: mat4x4f,
  inverseViewProjection: mat4x4f,
  camera: vec4f,
  sunTime: vec4f,
  viewport: vec4f,
  map: vec4f,
  interaction: vec4f,
  terrainInfo: vec4f,
  lighting: vec4f,
  sky: vec4f,
  weather: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var heightTexture: texture_2d<f32>;
@group(0) @binding(2) var surfaceTexture: texture_2d<u32>;
@group(0) @binding(3) var provinceTexture: texture_2d<u32>;
@group(0) @binding(4) var materialTexture: texture_2d_array<f32>;
@group(0) @binding(5) var materialSampler: sampler;
@group(0) @binding(6) var coastTexture: texture_2d<f32>;
@group(0) @binding(7) var navigationTexture: texture_2d<f32>;
@group(0) @binding(8) var terrainNormalTexture: texture_2d<f32>;
@group(0) @binding(9) var treeMaterialTexture: texture_2d_array<f32>;
@group(0) @binding(10) var provincePoliticalColorTexture: texture_2d<f32>;
@group(0) @binding(11) var diplomacyColorTexture: texture_2d<f32>;
@group(0) @binding(12) var<storage, read> visibleTerrainChunks: array<u32>;
@group(0) @binding(13) var terrainAlbedoTexture: texture_2d<f32>;
/** One texel per encoded province id: food, stone, metal, oil potential. */
@group(0) @binding(18) var provinceResourcePotentialTexture: texture_2d<f32>;

fn wrappedUv(uv: vec2f) -> vec2f {
  return vec2f(fract(uv.x + 1.0), clamp(uv.y, 0.0, 0.999999));
}

fn heightAt(uvInput: vec2f) -> f32 {
  let uv = wrappedUv(uvInput);
  let dimensions = vec2i(textureDimensions(heightTexture));
  let position = uv * vec2f(dimensions) - vec2f(0.5);
  let base = vec2i(floor(position));
  let blend = fract(position);
  let x0 = ((base.x % dimensions.x) + dimensions.x) % dimensions.x;
  let x1 = (x0 + 1) % dimensions.x;
  let y0 = clamp(base.y, 0, dimensions.y - 1);
  let y1 = clamp(base.y + 1, 0, dimensions.y - 1);
  let top = mix(textureLoad(heightTexture, vec2i(x0, y0), 0).r, textureLoad(heightTexture, vec2i(x1, y0), 0).r, blend.x);
  let bottom = mix(textureLoad(heightTexture, vec2i(x0, y1), 0).r, textureLoad(heightTexture, vec2i(x1, y1), 0).r, blend.x);
  return mix(top, bottom, blend.y);
}

fn provinceAt(uvInput: vec2f) -> u32 {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(provinceTexture);
  let coordinate = vec2i(min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))), min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y))));
  return textureLoad(provinceTexture, coordinate, 0).r;
}

fn resourcePotentialFor(encodedProvinceId: u32) -> vec4f {
  let dimensions = textureDimensions(provinceResourcePotentialTexture);
  let x = min(i32(encodedProvinceId), i32(dimensions.x) - 1);
  return textureLoad(provinceResourcePotentialTexture, vec2i(x, 0), 0);
}

fn politicalColorAt(uvInput: vec2f) -> vec4f {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(provincePoliticalColorTexture);
  let coordinate = vec2i(min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))), min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y))));
  return textureLoad(provincePoliticalColorTexture, coordinate, 0);
}

fn politicalOwnerAt(uvInput: vec2f) -> u32 {
  return u32(round(politicalColorAt(uvInput).a * 255.0));
}

fn diplomacyColorFor(owner: u32) -> vec4f {
  let dimensions = textureDimensions(diplomacyColorTexture);
  let x = min(i32(owner), i32(dimensions.x) - 1);
  return textureLoad(diplomacyColorTexture, vec2i(x, 0), 0);
}

fn surfaceAt(uvInput: vec2f) -> vec4u {
  let uv = wrappedUv(uvInput);
  let dimensions = textureDimensions(surfaceTexture);
  let coordinate = vec2i(min(i32(dimensions.x) - 1, i32(uv.x * f32(dimensions.x))), min(i32(dimensions.y) - 1, i32(uv.y * f32(dimensions.y))));
  return textureLoad(surfaceTexture, coordinate, 0);
}

fn waterDepthAt(uvInput: vec2f) -> f32 {
  let uv = wrappedUv(uvInput);
  let dimensions = vec2i(textureDimensions(surfaceTexture));
  let position = uv * vec2f(dimensions) - vec2f(0.5);
  let base = vec2i(floor(position));
  let blend = fract(position);
  let x0 = ((base.x % dimensions.x) + dimensions.x) % dimensions.x;
  let x1 = (x0 + 1) % dimensions.x;
  let y0 = clamp(base.y, 0, dimensions.y - 1);
  let y1 = clamp(base.y + 1, 0, dimensions.y - 1);
  let top = mix(f32(textureLoad(surfaceTexture, vec2i(x0, y0), 0).b), f32(textureLoad(surfaceTexture, vec2i(x1, y0), 0).b), blend.x);
  let bottom = mix(f32(textureLoad(surfaceTexture, vec2i(x0, y1), 0).b), f32(textureLoad(surfaceTexture, vec2i(x1, y1), 0).b), blend.x);
  return mix(top, bottom, blend.y) / 255.0;
}

fn bankFieldAt(uvInput: vec2f) -> vec2f { return textureSampleLevel(coastTexture, materialSampler, wrappedUv(uvInput), 0.0).rg; }
fn landAt(uvInput: vec2f) -> f32 { return bankFieldAt(uvInput).r; }
fn bankAt(uvInput: vec2f) -> f32 { return bankFieldAt(uvInput).g; }
fn navigationAt(uvInput: vec2f) -> vec4f { return textureSampleLevel(navigationTexture, materialSampler, wrappedUv(uvInput), 0.0); }
fn roadAt(uvInput: vec2f) -> vec2f { return navigationAt(uvInput).rg; }
fn waterwayFieldAt(uvInput: vec2f) -> vec2f { return navigationAt(uvInput).ba; }
fn waterwayAt(uvInput: vec2f) -> f32 { return waterwayFieldAt(uvInput).r; }
fn visualRiverAt(uvInput: vec2f) -> f32 { return waterwayFieldAt(uvInput).g; }

fn terrainNormal(uv: vec2f) -> vec3f {
  let encoded = textureSampleLevel(terrainNormalTexture, materialSampler, wrappedUv(uv), 0.0).rg;
  let normalY = sqrt(max(0.0, 1.0 - dot(encoded, encoded)));
  return normalize(vec3f(encoded.x, normalY, encoded.y));
}

fn hashColor(id: u32) -> vec3f {
  let n = f32((id * 1664525u + 1013904223u) & 1023u) / 1023.0;
  return 0.32 + 0.56 * vec3f(fract(n * 1.71), fract(n * 2.37 + 0.21), fract(n * 3.13 + 0.47));
}

fn noiseHash(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn valueNoise(point: vec2f) -> f32 {
  let cell = floor(point);
  let local = fract(point);
  let blend = local * local * (3.0 - 2.0 * local);
  let a = noiseHash(cell);
  let b = noiseHash(cell + vec2f(1.0, 0.0));
  let c = noiseHash(cell + vec2f(0.0, 1.0));
  let d = noiseHash(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

fn surfaceLight(normalInput: vec3f) -> vec3f {
  let normal = normalize(normalInput);
  let daylight = uniforms.lighting.x;
  let diffuse = max(dot(normal, normalize(uniforms.sunTime.xyz)), 0.0) * daylight;
  let dayAmbient = vec3f(0.46 + normal.y * 0.22);
  // Night lifted well off the old near-black so units and terrain stay visible
  // after dark; the cool blue cast still reads as night.
  let nightAmbient = vec3f(0.44, 0.49, 0.62) * (0.86 + normal.y * 0.12);
  let sunsetWarmth = vec3f(0.13, 0.055, 0.015) * uniforms.lighting.y * max(0.0, normal.y);
  return mix(nightAmbient, dayAmbient, daylight) + vec3f(diffuse * 0.62) + sunsetWarmth;
}

fn distanceFogColor() -> vec3f {
  let dayHaze = vec3f(0.58, 0.69, 0.72);
  let nightHaze = vec3f(0.105, 0.135, 0.23);
  let duskHaze = vec3f(0.62, 0.39, 0.29);
  let timeHaze = mix(mix(nightHaze, dayHaze, uniforms.lighting.x), duskHaze, uniforms.lighting.y * 0.34);
  return mix(timeHaze, uniforms.sky.rgb * 1.08, uniforms.weather.x * 0.62);
}

fn wetSurfaceSheen(normalInput: vec3f, worldPosition: vec3f) -> vec3f {
  let normal = normalize(normalInput);
  let viewDirection = normalize(uniforms.camera.xyz - worldPosition);
  let upward = smoothstep(0.38, 0.96, normal.y);
  let grazing = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
  let closeVisibility = 1.0 - smoothstep(1500.0, 3300.0, distance(uniforms.camera.xyz, worldPosition));
  return uniforms.sky.rgb * (0.075 + grazing * 0.28)
    * upward * closeVisibility * uniforms.weather.x;
}

fn oceanWaveHeight(world: vec2f, openWater: f32) -> f32 {
  let time = uniforms.sunTime.w;
  let windWarp = valueNoise(world / 920.0 + vec2f(time * 0.006, -time * 0.004)) - 0.5;
  let directionA = normalize(vec2f(0.88 + windWarp * 0.42, 0.47 - windWarp * 0.28));
  let directionB = normalize(vec2f(-0.31 + windWarp * 0.22, 0.95));
  let packet = 0.68 + valueNoise(world / 310.0 - vec2f(time * 0.018, time * 0.011)) * 0.42;
  return (sin(dot(world, directionA) * 0.014 + time * (0.47 + windWarp * 0.08)) * 0.42
    + sin(dot(world, directionB) * 0.026 - time * 0.39 + windWarp * 2.1) * 0.24
    + sin(dot(world, normalize(directionA + directionB * 0.37)) * 0.061 + time * 0.83) * 0.08)
    * packet * mix(0.09, 1.0, openWater) * mix(1.0, 1.18, uniforms.weather.x);
}

fn oceanSurfaceColor(worldPosition: vec3f, depth: f32, shoreline: f32, visualRiver: f32) -> vec3f {
  let time = uniforms.sunTime.w;
  let world = worldPosition.xz;
  // uniforms.interaction.y is the camera orbit distance. As the camera pulls
  // back to regional/overview zoom the shallow shelf band and shoreline foam
  // stop being detail and start reading as a thick cyan halo that is wider
  // than small islands. Collapse both toward a clean deep-ocean edge with
  // altitude; near the ground everything below is unchanged (overview == 0).
  let overview = smoothstep(2400.0, 6800.0, uniforms.interaction.y);
  let warp = vec2f(valueNoise(world / 175.0 + vec2f(time * 0.025, -time * 0.017)),
    valueNoise(world / 243.0 + vec2f(-time * 0.013, time * 0.021))) - 0.5;
  let waveA = sin(dot(world + warp * 36.0, normalize(vec2f(0.86, 0.51))) * 0.019 + time * 0.53);
  let waveB = sin(dot(world - warp * 24.0, normalize(vec2f(-0.28, 0.96))) * 0.034 - time * 0.41);
  let rippleNoise = valueNoise(world / 19.0 + warp * 1.7 + vec2f(time * 0.11, -time * 0.07));
  let ripple = rippleNoise * 2.0 - 1.0;
  let normal = normalize(vec3f((waveA * 0.78 + waveB * 0.41 + ripple * 0.22) * 0.105, 1.0,
    (waveA * 0.38 - waveB * 0.82 + ripple * 0.19) * 0.09));
  let viewDirection = normalize(uniforms.camera.xyz - worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 112.0);
  let shelf = smoothstep(0.0, mix(0.44, 0.12, overview), depth);
  let shallow = vec3f(0.09, 0.38, 0.44);
  let deep = vec3f(0.025, 0.16, 0.255);
  var color = mix(shallow, deep, shelf);
  // Even at ground level the shallow band + shoreline foam hug the coast too
  // widely and read as a glowing cyan rim - worst around island clusters. Pull
  // near-shore water toward the deep colour, calm the grazing-angle sheen, and
  // take strength out of the foam at every zoom; the overview term then
  // finishes collapsing them as the camera pulls back.
  color = mix(color, deep, 0.32);
  color = mix(color, deep, overview * 0.45);
  color = mix(color, vec3f(0.30, 0.46, 0.50), fresnel * 0.42);
  let foamBreak = valueNoise(world / 11.0 + warp * 2.4 + vec2f(time * 0.15, -time * 0.09));
  let foam = shoreline * (1.0 - visualRiver * 0.80)
    * smoothstep(0.54, 0.82, foamBreak + waveA * 0.12) * mix(0.55, 0.12, overview);
  color = mix(color, vec3f(0.73, 0.82, 0.77), foam * 0.52);
  color += vec3f(1.0, 0.86, 0.61) * sun * (0.34 + ripple * 0.05) * uniforms.lighting.x;
  color *= mix(vec3f(0.27, 0.36, 0.56), vec3f(1.0), uniforms.lighting.x);
  color += vec3f(0.18, 0.14, 0.11) * uniforms.lighting.y * fresnel;
  color = mix(color, color * vec3f(0.72, 0.79, 0.83), uniforms.weather.x * 0.32);
  return color;
}

fn applyOceanDistanceFog(color: vec3f, worldPosition: vec3f) -> vec3f {
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, worldPosition));
  return mix(color, distanceFogColor(), fog * 0.40);
}

fn worldFogColor() -> vec3f {
  // Keep the fully fogged edge identical to the render-pass clear color so
  // the final world geometry disappears without exposing its hard boundary.
  return uniforms.sky.rgb;
}

fn horizontalWorldFog(worldX: f32) -> f32 {
  // uniforms.camera.w stores the wrapped camera-target X. The fade window
  // follows that target, so moving sideways carries the hidden world edges
  // with the camera instead of revealing a fixed cutoff in map coordinates.
  let horizontalDistance = abs(worldX - uniforms.camera.w);
  return smoothstep(
    uniforms.map.x * ${WORLD_FOG_START_RATIO.toFixed(3)},
    uniforms.map.x * ${WORLD_FOG_END_RATIO.toFixed(3)},
    horizontalDistance
  );
}
`;
