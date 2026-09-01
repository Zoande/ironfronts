import { commonWgsl } from './common';

export const waterShader = commonWgsl + /* wgsl */ `
struct WaterVertexInput {
  @location(0) grid: vec2f,
  @location(1) skirt: f32,
};

struct WaterVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) mapUv: vec2f,
};

@vertex
fn waterVertex(input: WaterVertexInput, @builtin(instance_index) instanceIndex: u32) -> WaterVertexOutput {
  let chunksX = u32(uniforms.terrainInfo.x);
  let chunksY = u32(uniforms.terrainInfo.y);
  let chunksPerWorld = chunksX * chunksY;
  let visibleChunk = visibleTerrainChunks[instanceIndex];
  let copyIndex = visibleChunk / chunksPerWorld;
  let chunkIndex = visibleChunk % chunksPerWorld;
  let chunkX = chunkIndex % chunksX;
  let chunkY = chunkIndex / chunksX;
  let uv = vec2f((f32(chunkX) + input.grid.x) / f32(chunksX), (f32(chunkY) + input.grid.y) / f32(chunksY));
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let xz = vec2f(uv.x * uniforms.map.x + copyOffset, uv.y * uniforms.map.y);
  let openWater = 1.0 - bankAt(uv);
  let waveHeight = oceanWaveHeight(xz, openWater);
  let worldPosition = vec3f(uv.x * uniforms.map.x + copyOffset, 0.35 + waveHeight, uv.y * uniforms.map.y);
  var output: WaterVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapUv = uv;
  return output;
}

@fragment
fn waterFragment(input: WaterVertexOutput) -> @location(0) vec4f {
  let riverField = waterwayFieldAt(input.mapUv);
  if (riverField.r > 0.45 || riverField.g > 0.45) { discard; }
  // Water covers exactly the complement of terrain: terrain discards at
  // landAt <= 0.5 - COAST_OVERLAP, water at landAt > 0.5. The blocky-rectangle
  // shoreline holes were a chunk-LOD tessellation MISMATCH — the water grid was
  // coarser than terrain at LOD 0/1, so the interpolated landAt disagreed and a
  // fragment could fall in both discard zones. The water meshes now match the
  // terrain resolutions (renderer.ts), so this split is exact and gap-free.
  if (landAt(input.mapUv) > 0.5) { discard; }
  let visualRiver = 0.0;
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 6u) {
    return vec4f(mix(vec3f(0.012, 0.025, 0.032), vec3f(0.18, 0.48, 0.98), visualRiver), 1.0);
  }
  if (debugMode == 7u) {
    let depthDebug = mix(waterDepthAt(input.mapUv), 0.08, visualRiver);
    return vec4f(mix(vec3f(0.16, 0.66, 0.82), vec3f(0.015, 0.11, 0.28), depthDebug), 1.0);
  }
  if (debugMode == 9u) {
    return vec4f(mix(vec3f(0.025, 0.12, 0.25), vec3f(0.18, 0.48, 0.98), visualRiver), 1.0);
  }
  let depth = mix(waterDepthAt(input.mapUv), 0.08, visualRiver);
  let color = oceanSurfaceColor(input.worldPosition, depth, bankAt(input.mapUv), visualRiver);
  let distanceFogged = applyOceanDistanceFog(color, input.worldPosition);
  return vec4f(mix(distanceFogged, worldFogColor(), horizontalWorldFog(input.worldPosition.x)), 0.97);
}
`;
