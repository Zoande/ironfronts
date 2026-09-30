import { commonWgsl } from './common';

/**
 * World-space instanced strategic-map markers (resource deposits + road
 * junctions / small settlements). One `pass.draw(6, N)` call: every marker is
 * transformed on the GPU from its world position through `uniforms.viewProjection`
 * each frame, so markers stay locked to the terrain while panning with zero
 * per-frame CPU / DOM cost. Symbols are drawn procedurally — small, flat,
 * lightly outlined cartographic glyphs, not glowing pickups.
 *
 * Marker.data = (worldX, worldZ, kind, richness)
 *   kind: 0 stone, 1 metal, 2 oil, 3 road junction, 4 small town
 *   richness: 0..1, scales deposit-marker size (junction/town ignore it)
 */
export const mapMarkerShader = commonWgsl + /* wgsl */ `
struct Marker { data: vec4f };
struct MarkerParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> markers: array<Marker>;
@group(1) @binding(1) var<uniform> markerParams: MarkerParams;

struct MarkerOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) kind: f32,
  @location(2) alpha: f32,
};

@vertex
fn mapMarkerVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> MarkerOutput {
  let copyIndex = instanceIndex / markerParams.count;
  let marker = markers[instanceIndex % markerParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;

  let kind = marker.data.z;
  let richness = marker.data.w;
  let worldXZ = vec2f(marker.data.x, marker.data.y);
  let uv = worldXZ / uniforms.map.xy;
  let ground = heightAt(uv);
  // A small lift keeps the glyph off the surface; depth test is disabled so it
  // never disappears into a hillside at grazing angles.
  let worldPos = vec3f(worldXZ.x + copyOffset, ground + 2.0, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);

  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  // Camera orbit distance. Markers hold a near-constant screen size, shrink a
  // little at overview, and fade out entirely before strategic altitude so the
  // overview map stays clean.
  let zoom = uniforms.interaction.y;
  // Keep deposit markers legible through normal gameplay zoom; only fade them
  // approaching strategic altitude so the overview map stays clean.
  let rangeFade = 1.0 - smoothstep(3800.0, 4900.0, zoom);
  // Deposits are the "send my army here" resource cue — hold them visible much
  // further out than the generic marker fade so they stay readable while
  // planning a march from strategic zoom.
  let depositRangeFade = 1.0 - smoothstep(8200.0, 9800.0, zoom);
  let zoomScale = mix(0.85, 1.15, smoothstep(3600.0, 1000.0, zoom));

  var sizePx = 0.0;
  if (kind < 2.5) {
    sizePx = mix(20.0, 32.0, clamp(richness, 0.0, 1.0));   // stone / metal / oil
    // Gentle per-marker pulse (phased by world position so a field of deposits
    // doesn't breathe in lockstep) makes them read as "something is here"
    // rather than a static icon.
    let pulsePhase = noiseHash(worldXZ) * 6.2831853;
    sizePx = sizePx * (1.0 + 0.10 * sin(uniforms.sunTime.w * 1.6 + pulsePhase));
  } else if (kind < 3.5) {
    sizePx = 5.5;                                           // road junction dot
  } else {
    sizePx = 12.0;                                          // small town
  }
  sizePx = sizePx * zoomScale;

  var output: MarkerOutput;
  output.uv = corner;
  output.kind = kind;
  output.alpha = select(rangeFade, depositRangeFade, kind < 2.5) * (1.0 - mapFog(worldPos.xz));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = corner * sizePx * 2.0 / uniforms.viewport.xy;
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  return output;
}

// Antialiased fill coverage for a signed-distance shape (<0 inside). Fixed
// edge softness in UV space — the quad is only a few px, so a constant band
// reads cleanly and avoids screen-space derivatives in branchy control flow.
fn shapeCoverage(sd: f32) -> f32 {
  return 1.0 - smoothstep(-0.06, 0.06, sd);
}

@fragment
fn mapMarkerFragment(input: MarkerOutput) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv;
  let outlineInk = vec3f(0.10, 0.11, 0.09);

  var fill = vec3f(0.5);
  var sd = 0.0;           // signed distance: <0 inside shape, radius ~0.78
  var innerPip = 0.0;
  var ring = 0.0;

  if (input.kind < 0.5) {
    // Stone — rounded square, quarry slate.
    fill = vec3f(0.56, 0.57, 0.58);
    let q = abs(uv) - vec2f(0.52);
    sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - 0.16;
  } else if (input.kind < 1.5) {
    // Metal — diamond, cold steel.
    fill = vec3f(0.60, 0.66, 0.73);
    sd = (abs(uv.x) + abs(uv.y)) - 0.74;
  } else if (input.kind < 2.5) {
    // Oil — dark disc with a pale centre pip.
    fill = vec3f(0.17, 0.18, 0.16);
    sd = length(uv) - 0.72;
    innerPip = 1.0 - smoothstep(0.16, 0.24, length(uv));
  } else if (input.kind < 3.5) {
    // Road junction — plain small ink dot, no outline.
    let dot = 1.0 - smoothstep(0.42, 0.62, length(uv));
    if (dot < 0.02) { discard; }
    return vec4f(vec3f(0.24, 0.21, 0.16), dot * 0.9 * input.alpha);
  } else {
    // Small town — parchment disc with a dark ring.
    fill = vec3f(0.83, 0.74, 0.55);
    sd = length(uv) - 0.66;
    ring = (1.0 - smoothstep(0.03, 0.07, abs(length(uv) - 0.5)));
  }

  let inside = shapeCoverage(sd);
  let outline = shapeCoverage(sd - 0.2) - inside;   // band just outside the fill
  if (inside + outline < 0.02) { discard; }

  var rgb = mix(fill, outlineInk, clamp(outline * 1.15 + ring, 0.0, 1.0));
  rgb = mix(rgb, vec3f(0.86, 0.85, 0.78), innerPip);
  // A faint parchment cast under the fill lifts markers off dark forest / water.
  rgb = mix(rgb, rgb * 1.08 + vec3f(0.04), inside * 0.5);
  let coverage = clamp(inside + outline, 0.0, 1.0);
  return vec4f(rgb, coverage * 0.97 * input.alpha);
}
`;
