import { commonWgsl } from './common';

export const propShader = commonWgsl + /* wgsl */ `
// Map-scale prop sizing. The world buffers were baked when props read larger;
// rather than force a full world rebuild these bring towns and forests down to a
// strategic-map scale. Footprint is trimmed harder than height so a town still
// has a silhouette. Nothing gameplay reads these (no picking, no road/army
// height) — terrain height stays the shared authoritative path.
// Trimmed again (0.60 -> 0.42 footprint, 0.72 -> 0.52 height): at strategic
// zoom a town should read as a small dense cluster, not a handful of
// road-width-wide blocks. The landmark archetype (4) still mixes back toward
// full size below so a capital keeps its presence.
const BUILDING_FOOTPRINT_SCALE = 0.42;
const BUILDING_HEIGHT_SCALE = 0.52;
const TREE_MAP_SCALE = 0.66;

struct InstanceRecord { a: vec4f, b: vec4f };
struct InstanceParams { count: u32, kind: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> instances: array<InstanceRecord>;
@group(1) @binding(1) var<uniform> instanceParams: InstanceParams;
@group(1) @binding(2) var<storage, read> visibleInstances: array<u32>;

struct PropVertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) materialPart: f32,
};

struct PropVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) visibility: f32,
  @location(4) opacity: f32,
  @location(5) materialUv: vec2f,
  @location(6) treeMaterialLayer: f32,
  @location(7) @interpolate(flat) emissiveKind: f32,
};

fn rotateY(value: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(value.x * c - value.z * s, value.y, value.x * s + value.z * c);
}

fn treePartCenter(variant: u32, part: u32) -> vec3f {
  if (part == 0u) { return vec3f(0.0); }
  if (variant == 0u) {
    if (part == 1u) { return vec3f(-1.55, 6.55, 0.15); }
    if (part == 2u) { return vec3f(1.40, 6.85, -0.45); }
    return vec3f(0.0, 8.25, 0.20);
  }
  if (variant == 1u) {
    if (part == 1u) { return vec3f(0.0, 6.25, 0.0); }
    if (part == 2u) { return vec3f(-0.22, 8.05, 0.18); }
    return vec3f(0.18, 9.65, -0.12);
  }
  if (variant == 2u) {
    if (part == 4u) { return vec3f(0.0, 5.0, 0.0); }
    if (part == 5u) { return vec3f(0.0, 7.35, 0.0); }
    return vec3f(0.0, 9.45, 0.0);
  }
  if (variant == 3u) {
    if (part == 1u) { return vec3f(-2.05, 6.15, 0.15); }
    if (part == 2u) { return vec3f(1.90, 6.35, -0.40); }
    return vec3f(0.0, 7.05, 0.45);
  }
  if (part == 1u) { return vec3f(-0.62, 4.45, 0.10); }
  if (part == 2u) { return vec3f(0.68, 5.05, -0.12); }
  return vec3f(0.0, 5.55, 0.20);
}

fn treePartScale(variant: u32, part: u32) -> vec3f {
  if (part == 0u) {
    if (variant == 0u) { return vec3f(0.62, 4.55, 0.62); }
    if (variant == 1u) { return vec3f(0.48, 5.45, 0.48); }
    if (variant == 2u) { return vec3f(0.50, 5.80, 0.50); }
    if (variant == 3u) { return vec3f(0.72, 4.05, 0.72); }
    return vec3f(0.36, 3.25, 0.36);
  }
  if (variant == 0u) {
    if (part == 1u) { return vec3f(2.45, 2.55, 2.25); }
    if (part == 2u) { return vec3f(2.30, 2.40, 2.15); }
    return vec3f(2.70, 2.65, 2.45);
  }
  if (variant == 1u) {
    if (part == 1u) { return vec3f(1.75, 2.55, 1.65); }
    if (part == 2u) { return vec3f(1.62, 2.45, 1.55); }
    return vec3f(1.42, 2.10, 1.38);
  }
  if (variant == 2u) {
    if (part == 4u) { return vec3f(3.15, 3.00, 3.15); }
    if (part == 5u) { return vec3f(2.55, 2.75, 2.55); }
    return vec3f(1.85, 2.45, 1.85);
  }
  if (variant == 3u) {
    if (part == 1u) { return vec3f(3.05, 1.55, 2.40); }
    if (part == 2u) { return vec3f(2.95, 1.65, 2.45); }
    return vec3f(3.25, 1.75, 2.65);
  }
  if (part == 1u) { return vec3f(1.25, 1.42, 1.18); }
  if (part == 2u) { return vec3f(1.42, 1.55, 1.32); }
  return vec3f(1.05, 1.20, 1.00);
}

fn treePartVisible(variant: u32, part: u32) -> bool {
  if (part == 0u) { return true; }
  if (variant == 2u) { return part >= 4u; }
  if (part >= 4u) { return false; }
  return variant != 4u || part < 3u;
}

fn treeMaterialUv(position: vec3f, normal: vec3f, bark: bool) -> vec2f {
  let absoluteNormal = abs(normal);
  if (bark) {
    if (absoluteNormal.y > 0.75) { return position.xz + 0.5; }
    let across = select(position.x, position.z, absoluteNormal.x > absoluteNormal.z);
    return vec2f(across + 0.5, position.y * 2.0);
  }
  if (absoluteNormal.y > absoluteNormal.x && absoluteNormal.y > absoluteNormal.z) {
    return position.xz * 0.55 + 0.5;
  }
  if (absoluteNormal.x > absoluteNormal.z) { return position.zy * 0.55 + 0.5; }
  return position.xy * 0.55 + 0.5;
}

@vertex
fn propVertex(input: PropVertexInput, @builtin(instance_index) instanceIndex: u32) -> PropVertexOutput {
  let count = instanceParams.count;
  let visibleInstance = visibleInstances[instanceIndex];
  let copyIndex = visibleInstance / count;
  let record = instances[visibleInstance % count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let mapUv = vec2f(record.a.x / uniforms.map.x, record.a.y / uniforms.map.y);
  let ground = heightAt(mapUv);
  var local = input.position;
  var color = vec3f(0.28, 0.36, 0.22);
  var angle = 0.0;
  var transformedNormal = input.normal;
  var opacity = 1.0;
  var materialUv = vec2f(0.0);
  var treeMaterialLayer = -1.0;
  var emissiveKind = 0.0;
  // Regional city LOD (buildings only). Set inside the kind == 1u branch and
  // folded into the final visibility term so it also drives the fragment
  // discard. 1.0 means "full close-up city"; lower values thin the cluster.
  var buildingLod = 1.0;

  if (instanceParams.kind == 0u) {
    let variant = min(u32(record.a.w + 0.5), 4u);
    let part = u32(input.materialPart + 0.5);
    let partScale = treePartScale(variant, part);
    local = (local * partScale + treePartCenter(variant, part)) * record.a.z * TREE_MAP_SCALE;
    angle = record.b.x;
    transformedNormal = rotateY(normalize(input.normal / max(partScale, vec3f(0.001))), angle);
    opacity = select(0.0, 1.0, treePartVisible(variant, part));
    color = vec3f(record.b.y);
    materialUv = treeMaterialUv(input.position, input.normal, part == 0u);
    treeMaterialLayer = select(clamp(record.b.w, 0.0, 1.0), 2.0, part == 0u);
  } else if (instanceParams.kind == 1u) {
    let archetype = u32(record.b.w + 0.5);
    let palette = u32(floor(record.b.z));
    let tint = fract(record.b.z);
    if (input.materialPart > 1.5 && input.materialPart < 2.5 && archetype != 3u) { opacity = 0.0; }
    if (input.materialPart > 2.5 && input.materialPart < 3.5 && archetype != 4u) { opacity = 0.0; }
    if (input.materialPart > 3.5 && input.materialPart < 4.5 && archetype != 1u) { opacity = 0.0; }
    if (input.materialPart > 4.5 && input.materialPart < 5.5 && archetype != 2u) { opacity = 0.0; }
    if (input.materialPart > 0.5 && input.materialPart < 1.5 && (archetype == 1u || archetype == 2u)) { opacity = 0.0; }
    if (archetype == 2u && input.materialPart > 0.5 && input.materialPart < 1.5) {
      local.y = 1.0 + (local.y - 1.0) * 0.16;
    } else if (archetype == 3u && input.materialPart > 0.5 && input.materialPart < 1.5) {
      local.y = 1.0 + (local.y - 1.0) * 0.42;
    }
    local *= vec3f(record.a.z, record.a.w, record.b.x);
    // Landmark archetype (4) keeps most of its bulk so a capital still reads;
    // every other structure is pulled down to a map-scale block.
    let mapFootprint = select(BUILDING_FOOTPRINT_SCALE, mix(BUILDING_FOOTPRINT_SCALE, 1.0, 0.55), archetype == 4u);
    let mapHeight = select(BUILDING_HEIGHT_SCALE, mix(BUILDING_HEIGHT_SCALE, 1.0, 0.5), archetype == 4u);
    local *= vec3f(mapFootprint, mapHeight, mapFootprint);
    // As the camera pulls back to regional/overview zoom, dense city clusters
    // read as oversized miniature towns. Keep the silhouette and the landmark
    // archetype (4) intact, but tighten every other building's footprint,
    // lower its height toward a map-scale block, and fade out a staggered
    // fraction of them so the cluster stops competing with labels and roads.
    let regionalLod = smoothstep(1400.0, 2800.0, uniforms.interaction.y);
    if (archetype != 4u) {
      local.x *= mix(1.0, 0.82, regionalLod);
      local.z *= mix(1.0, 0.82, regionalLod);
      local.y *= mix(1.0, 0.5, regionalLod);
      let lodHash = noiseHash(vec2f(f32(visibleInstance % count), 7.31));
      let lodStart = 0.25 + lodHash * 0.55;
      buildingLod = 1.0 - smoothstep(lodStart, lodStart + 0.25, regionalLod) * 0.6;
    }
    let wallPalette = array<vec3f, 4>(
      vec3f(0.47, 0.44, 0.38), vec3f(0.67, 0.57, 0.43),
      vec3f(0.64, 0.59, 0.49), vec3f(0.43, 0.45, 0.43)
    );
    color = wallPalette[min(palette, 3u)] * (0.82 + tint * 0.22);
    let absoluteNormal = abs(input.normal);
    materialUv = select(input.position.zy, input.position.xy, absoluteNormal.z > absoluteNormal.x);
    if (input.materialPart < 0.5 && absoluteNormal.y < 0.5) { emissiveKind = 1.0; }
    if ((input.materialPart > 0.5 && input.materialPart < 1.5) || (input.materialPart > 3.5 && input.materialPart < 5.5)) {
      let roofPalette = array<vec3f, 4>(vec3f(0.25, 0.18, 0.14), vec3f(0.44, 0.31, 0.20), vec3f(0.39, 0.25, 0.18), vec3f(0.22, 0.25, 0.25));
      color = roofPalette[min(palette, 3u)] * (0.86 + tint * 0.12);
    } else if (input.materialPart > 1.5) {
      color = select(vec3f(0.31, 0.32, 0.30), vec3f(0.47, 0.43, 0.35), archetype == 4u);
    }
  } else {
    local *= vec3f(record.a.z, record.a.w, record.b.x);
    angle = record.b.y;
    transformedNormal = rotateY(input.normal, angle);
    if (instanceParams.kind == 2u) {
      color = select(vec3f(0.15, 0.17, 0.16), vec3f(1.0, 0.72, 0.34), input.materialPart > 0.5);
      if (input.materialPart > 0.5) { emissiveKind = 2.0; }
    } else if (instanceParams.kind == 3u) {
      color = select(vec3f(0.25, 0.22, 0.17), vec3f(0.29, 0.31, 0.30), record.b.w < 0.5);
    } else {
      color = select(vec3f(0.24, 0.27, 0.25), vec3f(0.72, 0.62, 0.39), input.materialPart > 0.5);
    }
  }

  local = rotateY(local, angle);
  let worldPosition = vec3f(record.a.x + copyOffset + local.x, ground + local.y, record.a.y + local.z);
  let maximumDistance = select(select(1900.0, 2600.0, instanceParams.kind == 1u), 3200.0, instanceParams.kind == 0u);
  let visibility = (1.0 - smoothstep(maximumDistance * 0.75, maximumDistance, distance(uniforms.camera.xyz, worldPosition))) * buildingLod;
  var output: PropVertexOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.normal = transformedNormal;
  output.color = color;
  output.visibility = visibility;
  output.opacity = opacity;
  output.materialUv = materialUv;
  output.treeMaterialLayer = treeMaterialLayer;
  output.emissiveKind = emissiveKind;
  return output;
}

@fragment
fn propFragment(input: PropVertexOutput) -> @location(0) vec4f {
  if (input.visibility < 0.03 || input.opacity < 0.03) { discard; }
  let normal = normalize(input.normal);
  var albedo = input.color;
  if (input.treeMaterialLayer > -0.5) {
    let materialLod = clamp(log2(max(1.0, distance(uniforms.camera.xyz, input.worldPosition) / 360.0)), 0.0, 8.0);
    var treeMaterial = textureSampleLevel(treeMaterialTexture, materialSampler, input.materialUv, i32(input.treeMaterialLayer + 0.5), materialLod).rgb;
    if (input.treeMaterialLayer < 0.5) {
      treeMaterial = mix(treeMaterial, vec3f(0.20, 0.38, 0.11), 0.32);
    } else if (input.treeMaterialLayer < 1.5) {
      treeMaterial = mix(treeMaterial, vec3f(0.09, 0.24, 0.12), 0.38);
    }
    albedo *= treeMaterial;
  }
  albedo = mix(albedo, albedo * vec3f(0.72, 0.78, 0.81), uniforms.weather.x * 0.40);
  let distanceToCamera = distance(uniforms.camera.xyz, input.worldPosition);
  let fog = smoothstep(3100.0, 9200.0, distanceToCamera);
  let worldFog = horizontalWorldFog(input.worldPosition.x);
  var emission = vec3f(0.0);
  if (input.emissiveKind > 0.5 && input.emissiveKind < 1.5) {
    let windowGrid = (input.materialUv + vec2f(0.5, 0.0)) * vec2f(5.0, 5.0);
    let windowCell = floor(windowGrid);
    let windowLocal = fract(windowGrid);
    let inset = smoothstep(vec2f(0.16, 0.20), vec2f(0.25, 0.28), windowLocal)
      * (vec2f(1.0) - smoothstep(vec2f(0.72, 0.68), vec2f(0.84, 0.80), windowLocal));
    let windowShape = inset.x * inset.y;
    let occupancy = select(0.0, 1.0, noiseHash(windowCell + floor(input.worldPosition.xz * 0.071)) > 0.34);
    emission = vec3f(1.0, 0.58, 0.19) * windowShape * occupancy * uniforms.lighting.z * 1.35;
  } else if (input.emissiveKind > 1.5) {
    emission = vec3f(1.0, 0.60, 0.22) * uniforms.lighting.z * 1.65;
  }
  var wetSheen = vec3f(0.0);
  if (input.treeMaterialLayer < -0.5) { wetSheen = wetSurfaceSheen(normal, input.worldPosition); }
  // Floor the lighting term for buildings (treeMaterialLayer < -0.5) so faces
  // turned away from the sun keep fill light. Dark roof palettes on a shaded
  // side were rendering whole cities as flat black. Trees keep full shading.
  let litShade = surfaceLight(normal);
  let shade = select(litShade, max(litShade, vec3f(0.46)), input.treeMaterialLayer < -0.5);
  let color = mix(mix(albedo * shade + emission + wetSheen, distanceFogColor(), fog * 0.39), worldFogColor(), worldFog);
  return vec4f(color, input.visibility * input.opacity * (1.0 - worldFog));
}
`;
