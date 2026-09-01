import { commonWgsl } from './common';

export const POLITICAL_OVERVIEW_START_ALTITUDE = 3_000;
export const POLITICAL_OVERVIEW_FULL_ALTITUDE = 6_500;
export const POLITICAL_CLOSE_TINT_STRENGTH = 0.1;
export const POLITICAL_OVERVIEW_MAX_STRENGTH = 0.82;
export const POLITICAL_MAP_TINT_STRENGTH = 0.85;
export const DIPLOMACY_CLOSE_TINT_STRENGTH = 0.3;

export const terrainShader = commonWgsl + /* wgsl */ `
struct TerrainVertexInput {
  @location(0) grid: vec2f,
  @location(1) skirt: f32,
};

struct TerrainVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) mapUv: vec2f,
  @location(2) chunkUv: vec2f,
};

@vertex
fn terrainVertex(input: TerrainVertexInput, @builtin(instance_index) instanceIndex: u32) -> TerrainVertexOutput {
  let chunksX = u32(uniforms.terrainInfo.x);
  let chunksY = u32(uniforms.terrainInfo.y);
  let chunksPerWorld = chunksX * chunksY;
  let visibleChunk = visibleTerrainChunks[instanceIndex];
  let copyIndex = visibleChunk / chunksPerWorld;
  let chunkIndex = visibleChunk % chunksPerWorld;
  let chunkX = chunkIndex % chunksX;
  let chunkY = chunkIndex / chunksX;
  let mapUv = vec2f(
    (f32(chunkX) + input.grid.x) / f32(chunksX),
    (f32(chunkY) + input.grid.y) / f32(chunksY)
  );
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let worldPosition = vec3f(
    mapUv.x * uniforms.map.x + copyOffset,
    heightAt(mapUv) - input.skirt * 36.0,
    mapUv.y * uniforms.map.y
  );
  var output: TerrainVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.mapUv = mapUv;
  output.chunkUv = input.grid;
  return output;
}

fn sampleMaterial(layer: i32, worldPosition: vec3f, scale: f32) -> vec3f {
  let rawUvA = worldPosition.xz / scale;
  let rawUvB = (worldPosition.xz + vec2f(worldPosition.z * 0.17, worldPosition.x * -0.11)) / (scale * 3.71);
  let tileA = fract(rawUvA * 0.5) * 2.0;
  let tileB = fract(rawUvB * 0.5) * 2.0;
  let uvA = 1.0 - abs(tileA - 1.0);
  let uvB = 1.0 - abs(tileB - 1.0);
  let lod = clamp(log2(max(1.0, uniforms.interaction.y / 430.0)), 0.0, 8.0);
  let detail = textureSampleLevel(materialTexture, materialSampler, uvA, layer, lod).rgb;
  let broadDetail = textureSampleLevel(materialTexture, materialSampler, uvB, layer, max(0.0, lod - 0.7)).rgb;
  return mix(detail, broadDetail, 0.18);
}

fn sameSurfaceMaterial(a: vec4u, b: vec4u) -> bool {
  return a.r == b.r && a.g == b.g;
}

fn surfaceTransitionAt(mapUv: vec2f, center: vec4u) -> f32 {
  let dimensions = vec2f(textureDimensions(surfaceTexture));
  let texel = 1.0 / dimensions;
  let cellUv = fract(wrappedUv(mapUv) * dimensions);
  let left = surfaceAt(mapUv - vec2f(texel.x, 0.0));
  let right = surfaceAt(mapUv + vec2f(texel.x, 0.0));
  let up = surfaceAt(mapUv - vec2f(0.0, texel.y));
  let down = surfaceAt(mapUv + vec2f(0.0, texel.y));
  var transition = 0.0;
  if (!sameSurfaceMaterial(center, left)) {
    transition = max(transition, 1.0 - smoothstep(0.0, 0.82, cellUv.x));
  }
  if (!sameSurfaceMaterial(center, right)) {
    transition = max(transition, 1.0 - smoothstep(0.0, 0.82, 1.0 - cellUv.x));
  }
  if (!sameSurfaceMaterial(center, up)) {
    transition = max(transition, 1.0 - smoothstep(0.0, 0.82, cellUv.y));
  }
  if (!sameSurfaceMaterial(center, down)) {
    transition = max(transition, 1.0 - smoothstep(0.0, 0.82, 1.0 - cellUv.y));
  }
  return transition;
}

@fragment
fn terrainFragment(input: TerrainVertexOutput) -> @location(0) vec4f {
  let bankField = bankFieldAt(input.mapUv);
  // Coast split: water discards where landAt > 0.5, terrain where landAt <= 0.5,
  // so the two passes tile the shoreline exactly once. This is only watertight
  // because water and terrain now tessellate identically at every LOD (see
  // renderer.ts waterMeshes) — landAt(input.mapUv) is per-pixel identical in
  // both passes. COAST_OVERLAP keeps a hair of terrain drawn past the contour
  // as float-precision insurance; it sits under the y=0.35 water plane so it
  // reads only as a wet edge, never a flooded beach.
  let COAST_OVERLAP = 0.03;
  if (bankField.r <= 0.5 - COAST_OVERLAP) { discard; }
  let navigation = navigationAt(input.mapUv);
  let riverField = navigation.ba;
  // Water owns only the inner channel. Its wider 0.45 coverage contour keeps
  // this conservative 0.60 terrain cut hidden even on coarse terrain LODs.
  if (riverField.r > 0.60 || riverField.g > 0.60) { discard; }

  let surface = surfaceAt(input.mapUv);
  let terrain = surface.r;
  let biome = surface.g;
  let variation = f32(surface.b) / 255.0;
  let normal = terrainNormal(input.mapUv);
  let slope = 1.0 - normal.y;
  let elevation = input.worldPosition.y;
  // The heightfield is nearly flat (max ~60 world units across a 13k-wide
  // map), so rock terrain shades as a flat grey plateau. Perturb the shading
  // normal with world-space noise on mountain/hill terrain to fake rugged
  // relief - geometry and gameplay heights are untouched.
  var shadeNormal = normal;
  // Only near the ground, where the relief is actually visible - at overview
  // rock covers most of the screen and this would just burn fill rate.
  if ((terrain == 1u || terrain == 2u || biome == 6u || biome == 8u) && uniforms.interaction.y < 3200.0) {
    let n = valueNoise(input.worldPosition.xz / 18.0) - 0.5;
    let w = sin(input.worldPosition.x * 0.13 + input.worldPosition.z * 0.09) * 0.5;
    let amp = mix(0.55, 1.4, slope);
    shadeNormal = normalize(normal + vec3f(n * 1.2 + w * 0.4, 0.0, w * 1.2 - n * 0.4) * amp);
  }
  let bakedSurface = textureSample(terrainAlbedoTexture, materialSampler, wrappedUv(input.mapUv));
  var baseColor = bakedSurface.rgb;
  var nightMapColor = vec3f(0.0);
  var nightMapCompensation = 0.0;
  if (uniforms.interaction.y < 4500.0) {
    baseColor = sampleMaterial(0, input.worldPosition, 92.0);
    if (biome == 1u || biome == 7u) {
      // Desert sand read as a harsh saturated orange against the greens. Pull
      // it toward a paler khaki so the contrast with neighbouring biomes is
      // less of a jump.
      let sand = sampleMaterial(2, input.worldPosition, 76.0);
      let sandGrey = vec3f(dot(sand, vec3f(0.34, 0.40, 0.26)));
      baseColor = mix(sand, mix(sandGrey, vec3f(0.70, 0.64, 0.49), 0.62), 0.34);
    } else if (biome == 2u && terrain != 3u) {
      baseColor = mix(sampleMaterial(0, input.worldPosition, 90.0), sampleMaterial(1, input.worldPosition, 74.0), 0.48);
    } else if (biome == 6u || biome == 8u) {
      baseColor = mix(sampleMaterial(5, input.worldPosition, 86.0), sampleMaterial(4, input.worldPosition, 68.0), slope * 2.0);
    }

    if (terrain == 1u) {
      // Lift the exposed-rock material off near-black so steep hills stay a
      // readable slate rather than a dark blob.
      let hillRock = sampleMaterial(4, input.worldPosition, 65.0) * 1.2 + vec3f(0.055, 0.055, 0.05);
      baseColor = mix(baseColor, hillRock, clamp(slope * 3.4 + 0.12, 0.0, 0.7));
    } else if (terrain == 2u) {
      let rock = sampleMaterial(4, input.worldPosition, 58.0) * 1.25 + vec3f(0.07, 0.07, 0.065);
      let snow = sampleMaterial(5, input.worldPosition, 80.0);
      let snowAmount = smoothstep(120.0, 205.0, elevation) * smoothstep(0.58, 0.92, normal.y);
      baseColor = mix(rock, snow, snowAmount);
    } else if (terrain == 3u) {
      // Forest floor was a very dark brown; between and under the canopy it
      // read as burnt ground. Lift it to a shaded earth / moss tone.
      baseColor = sampleMaterial(3, input.worldPosition, 70.0) * 1.5 + vec3f(0.06, 0.085, 0.05);
    } else if (terrain == 4u) {
      baseColor = mix(sampleMaterial(6, input.worldPosition, 54.0), sampleMaterial(1, input.worldPosition, 68.0), 0.22);
    }

    let shoreline = bankField.g * smoothstep(0.50, 0.72, bankField.r);
    baseColor = mix(baseColor, sampleMaterial(7, input.worldPosition, 52.0), shoreline * 0.72);
    // The baked albedo is linearly filtered, so using it only in the narrow
    // categorical boundary band removes square terrain/biome texel edges while
    // retaining full-resolution tiled material detail everywhere else.
    let surfaceTransition = surfaceTransitionAt(input.mapUv, surface);
    baseColor = mix(baseColor, bakedSurface.rgb, surfaceTransition * 0.92);
    baseColor = mix(baseColor, bakedSurface.rgb, smoothstep(3000.0, 4500.0, uniforms.interaction.y));
  }
  if (terrain == 3u) {
    // Forests should read as a darker, denser green mass from strategic
    // altitude, but the previous canopy colour was near-black and blended in
    // at 0.78. Stacked on baked prop AO and surface shading it collapsed
    // regional-zoom forest into flat black blobs. Lift the target to a deep
    // forest green and ease the blend so the canopy still darkens the terrain
    // without crushing it.
    let forestDistance = distance(uniforms.camera.xyz, input.worldPosition);
    let canopySignal = vec3f(0.17, 0.34, 0.18) * (0.86 + variation * 0.24);
    baseColor = mix(baseColor, canopySignal, smoothstep(1750.0, 3150.0, forestDistance) * 0.5);
  }

  if (uniforms.interaction.z > 0.5 && uniforms.map.w < 0.5) {
    let politicalColor = politicalColorAt(input.mapUv);
    let owner = u32(round(politicalColor.a * 255.0));
    if (owner > 0u) {
      let diplomacyMode = uniforms.interaction.z > 2.5;
      let diplomacyColor = diplomacyColorFor(owner);
      let isPlayer = diplomacyColor.a > 0.25 && diplomacyColor.a < 0.75;
      let hasRelationship = diplomacyColor.a > 0.75;
      var overlayColor = select(politicalColor.rgb, diplomacyColor.rgb, isPlayer || hasRelationship || diplomacyMode);
      if (hasRelationship) {
        overlayColor = min(diplomacyColor.rgb * 1.30, vec3f(1.0));
      }
      let overview = smoothstep(
        ${POLITICAL_OVERVIEW_START_ALTITUDE.toFixed(1)},
        ${POLITICAL_OVERVIEW_FULL_ALTITUDE.toFixed(1)},
        uniforms.camera.y
      );
      // Floor the terrain luminance the tint is matched against. Steep rock and
      // dense forest land near-black here, and without a floor the
      // luminance-matched political colour inherits that blackness, so overview
      // zoom cannot recover an owned mountain or forest province.
      let terrainLuminance = max(0.16, dot(baseColor, vec3f(0.24, 0.68, 0.08)));
      let tintLuminance = max(0.06, dot(overlayColor, vec3f(0.24, 0.68, 0.08)));
      let luminanceMatchedTint = overlayColor * (terrainLuminance / tintLuminance);
      let originalTint = overlayColor * (0.62 + terrainLuminance * 0.70);
      var preservation = 1.0 - overview;
      let politicalMode = uniforms.interaction.z > 1.5 && uniforms.interaction.z < 2.5;
      if (politicalMode) {
        preservation *= 0.70;
      }
      if (isPlayer) {
        preservation *= 0.45;
      }
      let biomeRetention = 0.20 * preservation;
      var coloredSurface = mix(originalTint, luminanceMatchedTint, preservation);
      coloredSurface = mix(coloredSurface, baseColor, biomeRetention);
      let balancedStrength = mix(
        ${POLITICAL_CLOSE_TINT_STRENGTH.toFixed(2)},
        ${POLITICAL_OVERVIEW_MAX_STRENGTH.toFixed(2)},
        overview
      );
      var overlayStrength = select(
        balancedStrength,
        ${POLITICAL_MAP_TINT_STRENGTH.toFixed(2)},
        uniforms.interaction.z > 1.5
      );
      if (hasRelationship && !diplomacyMode && uniforms.interaction.z < 1.5) {
        overlayStrength = max(overlayStrength, ${DIPLOMACY_CLOSE_TINT_STRENGTH.toFixed(2)});
      }
      if (diplomacyMode) {
        overlayStrength = mix(
          ${DIPLOMACY_CLOSE_TINT_STRENGTH.toFixed(2)},
          ${POLITICAL_OVERVIEW_MAX_STRENGTH.toFixed(2)},
          overview
        );
      }
      if (isPlayer) {
        let playerMinimumStrength = select(0.45, 0.85, uniforms.interaction.z > 1.5);
        overlayStrength = max(overlayStrength, playerMinimumStrength);
      }
      if (hasRelationship) {
        overlayStrength = ${POLITICAL_MAP_TINT_STRENGTH.toFixed(2)};
      }
      baseColor = mix(baseColor, coloredSurface, overlayStrength);
      // Political and diplomacy modes are ownership-first at every zoom.
      // Balanced mode only becomes ownership-first at strategic altitude. At
      // night, lift those presentations toward a controlled-luminance version
      // of their selected country/relationship color.
      nightMapColor = overlayColor;
      nightMapCompensation = uniforms.lighting.z
        * select(overview * 0.82, 1.0, politicalMode || diplomacyMode);
    }
  }

  let roadData = navigation.rg;
  let roadDistance = distance(uniforms.camera.xyz, input.worldPosition);
  let rangeVisibility = 1.0 - smoothstep(4000.0, 4800.0, roadDistance);
  let strategicBlend = mix(0.22, 1.0, smoothstep(1500.0, 3300.0, roadDistance));
  let roadCore = roadData.r * rangeVisibility * strategicBlend;
  let roadShoulder = max(0.0, roadData.g - roadData.r * 0.72) * rangeVisibility * 0.48;
  let aggregate = 0.88 + 0.12 * sin(input.worldPosition.x * 0.91 + sin(input.worldPosition.z * 1.37));
  let roadColor = vec3f(0.29, 0.235, 0.15) * aggregate;
  baseColor = mix(baseColor, mix(baseColor, roadColor, 0.48), roadShoulder);
  baseColor = mix(baseColor, roadColor, roadCore * 0.66);
  baseColor *= bakedSurface.a;

  baseColor *= 0.92 + variation * 0.14;
  baseColor = mix(baseColor, baseColor * vec3f(0.74, 0.79, 0.83), uniforms.weather.x * 0.42);
  let sunDirection = normalize(uniforms.sunTime.xyz);
  // Directional hillshade that grows with slope, so ridges and valleys read as
  // 3D relief instead of a flat patch. Flat terrain (plains, forest floor) is
  // untouched; the floor keeps shadowed steep faces lit, never the old black.
  let sunFacing = clamp(dot(shadeNormal, sunDirection) * 0.5 + 0.5, 0.0, 1.0);
  let reliefStrength = smoothstep(0.05, 0.36, slope) * uniforms.lighting.x;
  let relief = mix(1.0, mix(0.5, 1.45, sunFacing), reliefStrength);
  var lit = baseColor * max(surfaceLight(shadeNormal) * relief, vec3f(0.4));
  lit += vec3f(0.12, 0.15, 0.13) * pow(max(dot(normal, normalize(sunDirection + normalize(uniforms.camera.xyz - input.worldPosition))), 0.0), 24.0) * 0.08 * uniforms.lighting.x;
  lit += wetSurfaceSheen(normal, input.worldPosition);
  if (nightMapCompensation > 0.001) {
    let countryLuminance = max(0.08, dot(nightMapColor, vec3f(0.24, 0.68, 0.08)));
    let targetLuminance = mix(0.36, 0.52, smoothstep(0.10, 0.72, countryLuminance));
    let readableCountryColor = min(nightMapColor * (targetLuminance / countryLuminance), vec3f(1.0));
    lit = mix(lit, readableCountryColor, nightMapCompensation * 0.52);
  }

  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 1u) {
    let h = elevation / max(1.0, uniforms.map.z);
    lit = vec3f(h);
  } else if (debugMode == 2u) {
    let palette = array<vec3f, 5>(
      vec3f(0.40, 0.68, 0.32), vec3f(0.67, 0.58, 0.31), vec3f(0.58, 0.57, 0.55),
      vec3f(0.12, 0.42, 0.20), vec3f(0.53, 0.48, 0.43)
    );
    lit = palette[min(terrain, 4u)];
  } else if (debugMode == 3u) {
    lit = hashColor(provinceAt(input.mapUv));
  } else if (debugMode == 4u) {
    lit = normal * 0.5 + 0.5;
  } else if (debugMode == 5u) {
    let steepness = clamp((1.0 - normal.y) * 7.5, 0.0, 1.0);
    lit = mix(vec3f(0.08, 0.31, 0.22), vec3f(0.96, 0.22, 0.08), smoothstep(0.08, 0.82, steepness));
  } else if (debugMode == 6u) {
    let channels = navigation.ba;
    lit = vec3f(0.025, 0.035, 0.038);
    lit = mix(lit, vec3f(0.04, 0.88, 0.98), channels.r);
    lit = mix(lit, vec3f(0.18, 0.48, 0.98), channels.g * (1.0 - channels.r));
  } else if (debugMode == 7u) {
    let coast = landAt(input.mapUv);
    lit = mix(vec3f(0.74, 0.42, 0.16), vec3f(0.16, 0.62, 0.30), smoothstep(0.52, 0.96, coast));
  } else if (debugMode == 8u) {
    let footprint = max(roadData.r, roadData.g * 0.62);
    lit = mix(vec3f(0.025, 0.03, 0.032), mix(vec3f(0.94, 0.62, 0.10), vec3f(0.95, 0.18, 0.08), roadData.r), footprint);
  } else if (debugMode == 9u) {
    let channels = navigation.ba;
    let roadSignal = max(roadData.r, roadData.g * 0.45);
    lit = vec3f(0.15, 0.17, 0.16);
    lit = mix(lit, vec3f(0.96, 0.61, 0.12), roadSignal);
    lit = mix(lit, vec3f(0.02, 0.77, 0.96), channels.r);
    lit = mix(lit, vec3f(0.18, 0.48, 0.98), channels.g * (1.0 - channels.r));
  }

  if (uniforms.terrainInfo.w > 0.5) {
    let grid = min(abs(fract(input.chunkUv.x * 32.0) - 0.5), abs(fract(input.chunkUv.y * 32.0) - 0.5));
    lit = mix(vec3f(0.06, 0.11, 0.1), lit, smoothstep(0.005, 0.035, grid));
  }

  let distanceToCamera = distance(uniforms.camera.xyz, input.worldPosition);
  let fog = smoothstep(3600.0, 11500.0, distanceToCamera);
  let fogColor = distanceFogColor();
  let distanceFogged = mix(lit, fogColor, fog * 0.39);
  return vec4f(mix(distanceFogged, worldFogColor(), horizontalWorldFog(input.worldPosition.x)), 1.0);
}
`;
