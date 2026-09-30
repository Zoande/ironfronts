import { commonWgsl } from './common';

/**
 * World-space instanced army-stack markers.
 *
 * One `pass.draw(6, N)` — every stack marker is projected on the GPU from its
 * world position each frame, so markers track terrain while panning with no
 * per-frame CPU/DOM cost. The CPU only re-uploads the instance buffer when the
 * authoritative army set changes (spawn / move / merge / visibility), not per
 * frame.
 *
 * ArmyMarker.a = (worldX, worldZ, packedRGB, state)
 *   packedRGB: country colour, r*65536 + g*256 + b (0..255 each)
 *   state: 1 = visible (full), 2 = contact (enemy seen, composition unknown)
 *          hidden stacks are simply not emitted (fog is resolved CPU-side)
 * ArmyMarker.b = (unitCount, health01, flags, compositionRowCount)
 *   flags: bit 0 selected, bit 1 engaged / under fire
 * ArmyMarker.countsA/countsB = counts for up to six exact composition rows
 * ArmyMarker.kindsA/kindsB = kinds for those rows (0 infantry, 1 engineer,
 *   2 armoured car, 3 light tank, 4 medium tank, 5 artillery; 6 unused)
 * ArmyMarker.motion = (nextWaypointX, nextWaypointZ, remainingSeconds, sampleTime)
 *
 * The counter shows a painted strategic plaque with the two largest exact unit
 * categories and their counts, or a "?" for an unidentified contact, plus its
 * condition and selection state. Selecting a close-zoom stack opens a
 * two-column field roster with all six exact icon-and-amount entries.
 */
export const armyMarkerShader = commonWgsl + /* wgsl */ `
struct ArmyMarker {
  a: vec4f,
  b: vec4f,
  countsA: vec4f,
  countsB: vec4f,
  kindsA: vec4f,
  kindsB: vec4f,
  motion: vec4f,
};
struct ArmyParams { count: u32, mode: u32, pad0: u32, pad1: u32 };
@group(1) @binding(0) var<storage, read> armyMarkers: array<ArmyMarker>;
@group(1) @binding(1) var<uniform> armyParams: ArmyParams;
@group(0) @binding(14) var armyMarkerPlate: texture_2d<f32>;
@group(0) @binding(15) var armyMarkerPlateSampler: sampler;
@group(0) @binding(16) var armyUnitSilhouettes: texture_2d<f32>;
@group(0) @binding(17) var armyRosterPlate: texture_2d<f32>;

struct ArmyOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) state: f32,
  @location(3) @interpolate(flat) count: f32,
  @location(4) @interpolate(flat) health: f32,
  @location(5) @interpolate(flat) selected: f32,
  @location(6) alpha: f32,
  @location(7) @interpolate(flat) rows: f32,
  @location(8) @interpolate(flat) engaged: f32,
  @location(9) @interpolate(flat) countsA: vec4f,
  @location(10) @interpolate(flat) countsB: vec4f,
  @location(11) @interpolate(flat) kindsA: vec4f,
  @location(12) @interpolate(flat) kindsB: vec4f,
  @location(13) @interpolate(flat) panelHalf: vec2f,
  @location(14) @interpolate(flat) cluster: f32,
};

fn unpackRgb(packed: f32) -> vec3f {
  let v = u32(packed + 0.5);
  let r = f32((v >> 16u) & 255u) / 255.0;
  let g = f32((v >> 8u) & 255u) / 255.0;
  let b = f32(v & 255u) / 255.0;
  return vec3f(r, g, b);
}

fn markerWorldPosition(marker: ArmyMarker) -> vec2f {
  let travel = select(
    0.0,
    clamp((uniforms.sunTime.w - marker.motion.w) / max(marker.motion.z, 0.0001), 0.0, 1.0),
    marker.motion.z > 0.0,
  );
  return mix(marker.a.xy, marker.motion.xy, travel);
}

@vertex
fn armyMarkerVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> ArmyOut {
  let copyIndex = instanceIndex / armyParams.count;
  let marker = armyMarkers[instanceIndex % armyParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];

  let worldXZ = markerWorldPosition(marker);
  let uv = worldXZ / uniforms.map.xy;
  let ground = heightAt(uv);
  // a.w: 1 visible, 2 contact, 3 artillery range ring (world geometry),
  // 4 rally point (small constant-px billboard).
  let rangeMarker = marker.a.w > 2.5 && marker.a.w < 3.5;
  let rally = marker.a.w > 3.5;
  let rangeOffset = select(vec2f(0.0), corner * marker.b.x, rangeMarker);
  let rangeXZ = worldXZ + rangeOffset;
  let rangeUv = rangeXZ / uniforms.map.xy;
  let worldPos = vec3f(
    rangeXZ.x + copyOffset,
    select(ground + 4.0, heightAt(rangeUv) + 2.0, rangeMarker),
    rangeXZ.y,
  );
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);

  let zoom = uniforms.interaction.y;
  let contact = marker.a.w > 1.5;
  // Close in, the badge never vanishes — it thins to a floating ID tag over
  // the 3D models instead of disappearing. Far out, it holds much longer so
  // the strategic overview still shows where every stack is.
  let closeFade = select(mix(0.5, 1.0, smoothstep(650.0, 1300.0, zoom)), 1.0, contact);
  let rangeFade = closeFade * (1.0 - smoothstep(7600.0, 9200.0, zoom));
  let zoomScale = mix(1.0, 1.28, smoothstep(4600.0, 900.0, zoom));
  // Fixed 4:3 proportions match the generated cartouche so neither its
  // painted surface nor its live silhouettes are stretched.
  // viewport.z (render-scale) keeps the on-screen size constant across
  // graphics presets so it never balloons at low quality.
  let half = select(
    vec2f(33.0, 24.75) * zoomScale * uniforms.viewport.z,
    vec2f(15.0, 15.0) * uniforms.viewport.z,
    rally,
  );

  var output: ArmyOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.state = marker.a.w;
  output.count = marker.b.x;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  let markerFlags = u32(marker.b.z + 0.5);
  output.selected = f32(markerFlags & 1u);
  output.engaged = f32((markerFlags >> 1u) & 1u);
  output.cluster = f32((markerFlags >> 2u) & 1u);
  output.rows = marker.b.w;
  output.countsA = marker.countsA;
  output.countsB = marker.countsB;
  output.kindsA = marker.kindsA;
  output.kindsB = marker.kindsB;
  output.panelHalf = half;
  output.alpha = select(
    rangeFade,
    1.0 - smoothstep(7600.0, 9200.0, zoom),
    rally,
  ) * (1.0 - mapFog(worldPos.xz));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = corner * half * 2.0 / uniforms.viewport.xy;
  output.position = select(clip + vec4f(pixelOffset * clip.w, 0.0, 0.0), clip, rangeMarker);
  return output;
}

// 3x5 bitmap digits 0-9 and '?' (index 10). Bit 0 = top-left, row-major.
fn glyphBit(glyph: i32, col: i32, row: i32) -> f32 {
  if (col < 0 || col > 2 || row < 0 || row > 4) { return 0.0; }
  // 3x5 masks, bit = row*3 + col, bit 0 = top-left.
  var mask = 0u;
  switch (glyph) {
    case 0:  { mask = 0x7B6Fu; }   // XXX X.X X.X X.X XXX
    case 1:  { mask = 0x2492u; }   // .X. .X. .X. .X. .X.
    case 2:  { mask = 0x73E7u; }   // XXX ..X XXX X.. XXX
    case 3:  { mask = 0x79E7u; }   // XXX ..X XXX ..X XXX
    case 4:  { mask = 0x49EDu; }   // X.X X.X XXX ..X ..X
    case 5:  { mask = 0x79CFu; }   // XXX X.. XXX ..X XXX
    case 6:  { mask = 0x7BCFu; }   // XXX X.. XXX X.X XXX
    case 7:  { mask = 0x24A7u; }   // XXX ..X .X. .X. .X.
    case 8:  { mask = 0x7BEFu; }   // XXX X.X XXX X.X XXX
    case 9:  { mask = 0x79EFu; }   // XXX X.X XXX ..X XXX
    default: { mask = 0x21A7u; }   // ? : XXX ..X .XX ... .X.
  }
  let bit = u32(row * 3 + col);
  return select(0.0, 1.0, (mask & (1u << bit)) != 0u);
}

// Coverage of one glyph rendered into the box spanning [-w,w] x [-h,h] in uv.
fn glyphCoveragePx(
  glyph: i32,
  p: vec2f,
  center: vec2f,
  panelHalf: vec2f,
  cellSize: f32,
) -> f32 {
  // A 3x5 stencil uses square pixel cells in framebuffer space. This avoids
  // the wide, stretched numerals caused by measuring the glyph in panel UVs.
  let pixel = (p - center) * panelHalf;
  let local = vec2f(pixel.x / (cellSize * 1.5), pixel.y / (cellSize * 2.5));
  if (abs(local.x) > 1.0 || abs(local.y) > 1.0) { return 0.0; }
  let col = i32(floor((local.x * 0.5 + 0.5) * 3.0));
  let row = i32(floor((0.5 - local.y * 0.5) * 5.0));
  return glyphBit(glyph, col, row);
}

fn amountCoverage(value: i32, p: vec2f, center: vec2f, panelHalf: vec2f, cellSize: f32) -> f32 {
  let amount = clamp(value, 0, 999);
  if (amount < 10) {
    return glyphCoveragePx(amount, p, center, panelHalf, cellSize);
  }
  if (amount < 100) {
    let offset = 2.0 * cellSize / panelHalf.x;
    return glyphCoveragePx(amount / 10, p, center - vec2f(offset, 0.0), panelHalf, cellSize)
      + glyphCoveragePx(amount % 10, p, center + vec2f(offset, 0.0), panelHalf, cellSize);
  }
  let offset = 4.0 * cellSize / panelHalf.x;
  return glyphCoveragePx(amount / 100, p, center - vec2f(offset, 0.0), panelHalf, cellSize)
    + glyphCoveragePx((amount / 10) % 10, p, center, panelHalf, cellSize)
    + glyphCoveragePx(amount % 10, p, center + vec2f(offset, 0.0), panelHalf, cellSize);
}

fn squareLocal(p: vec2f, center: vec2f, panelHalf: vec2f, radiusPx: f32) -> vec2f {
  return (p - center) * panelHalf / vec2f(radiusPx);
}

fn unitKindIcon(kind: i32, q: vec2f) -> f32 {
  if (kind < 0 || kind > 5 || abs(q.x) > 1.0 || abs(q.y) > 1.0) { return 0.0; }
  // Stay half a source texel inside each 96 px cell so linear filtering never
  // leaks a neighbouring unit into the current silhouette.
  let cellUv = clamp(q * vec2f(0.5, -0.5) + vec2f(0.5), vec2f(0.5 / 96.0), vec2f(95.5 / 96.0));
  let atlasUv = vec2f(
    (f32(kind) + cellUv.x) / 6.0,
    cellUv.y,
  );
  return textureSampleLevel(armyUnitSilhouettes, armyMarkerPlateSampler, atlasUv, 0.0).a;
}

struct CompositionOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) rgb: vec3f,
  @location(2) @interpolate(flat) countsA: vec4f,
  @location(3) @interpolate(flat) countsB: vec4f,
  @location(4) @interpolate(flat) kindsA: vec4f,
  @location(5) @interpolate(flat) kindsB: vec4f,
  @location(6) @interpolate(flat) health: f32,
  @location(7) @interpolate(flat) selected: f32,
  @location(8) alpha: f32,
  @location(9) @interpolate(flat) panelHalf: vec2f,
};

fn compositionRowCount(countsA: vec4f, countsB: vec4f) -> f32 {
  return max(1.0,
    step(0.5, countsA.x) + step(0.5, countsA.y) + step(0.5, countsA.z) + step(0.5, countsA.w)
    + step(0.5, countsB.x) + step(0.5, countsB.y));
}

fn compositionValue(first: vec4f, second: vec4f, index: u32) -> f32 {
  if (index < 4u) { return first[index]; }
  return second[index - 4u];
}

@vertex
fn armyCompositionVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> CompositionOut {
  let copyIndex = instanceIndex / armyParams.count;
  let marker = armyMarkers[instanceIndex % armyParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let markerXZ = markerWorldPosition(marker);
  let worldXZ = vec2f(markerXZ.x + copyOffset, markerXZ.y);
  let worldPos = vec3f(worldXZ.x, heightAt(markerXZ / uniforms.map.xy) + 17.0, worldXZ.y);
  let clip = uniforms.viewProjection * vec4f(worldPos, 1.0);
  let rows = compositionRowCount(marker.countsA, marker.countsB);
  // This generated shield has one fixed 4:5 aspect. A fixed pixel frame also
  // means a six-row roster never distorts when the composition count changes.
  let half = vec2f(38.4, 48.0) * uniforms.viewport.z;
  let pixelCenter = vec2f(58.0, -2.0) * uniforms.viewport.z;

  var output: CompositionOut;
  output.uv = corner;
  output.rgb = unpackRgb(marker.a.z);
  output.countsA = marker.countsA;
  output.countsB = marker.countsB;
  output.kindsA = marker.kindsA;
  output.kindsB = marker.kindsB;
  output.health = clamp(marker.b.y, 0.0, 1.0);
  output.selected = f32(u32(marker.b.z + 0.5) & 1u);
  output.panelHalf = half;
  let identified = marker.a.w < 1.5;
  let needsManifest = rows > 2.0;
  let selected = output.selected > 0.5;
  output.alpha = select(
    0.0,
    1.0 - smoothstep(1400.0, 1800.0, uniforms.interaction.y),
    identified && needsManifest && selected,
  )
    * (1.0 - mapFog(worldPos.xz));
  if (clip.w <= 0.0001) {
    output.position = vec4f(0.0, 0.0, -10.0, 1.0);
    output.alpha = 0.0;
    return output;
  }
  let pixelOffset = (pixelCenter + corner * half) * 2.0 / uniforms.viewport.xy;
  output.position = clip + vec4f(pixelOffset * clip.w, -0.0003 * clip.w, 0.0);
  return output;
}

@fragment
fn armyCompositionFragment(input: CompositionOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv;
  let plateUv = vec2f(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5);
  let plaque = textureSampleLevel(armyRosterPlate, armyMarkerPlateSampler, plateUv, 0.0);
  let expandedUv = vec2f(uv.x * 0.46 + 0.5, 0.5 - uv.y * 0.46);
  let expandedAlpha = textureSampleLevel(armyRosterPlate, armyMarkerPlateSampler, expandedUv, 0.0).a;
  let selectedRing = max(0.0, expandedAlpha - plaque.a) * input.selected;
  let plateCoverage = plaque.a;
  if (plateCoverage + selectedRing < 0.02) { discard; }

  // The generated leather shield is the complete surface. Country colour is
  // only a quiet wash, never another flat rectangle drawn over it.
  var rgb = mix(plaque.rgb * 0.90, plaque.rgb * 0.74 + input.rgb * 0.26, plateCoverage * 0.22);

  let entries = u32(compositionRowCount(input.countsA, input.countsB));
  let rows = (entries + 1u) / 2u;
  let startY = f32(rows - 1u) * 0.22;
  for (var index = 0u; index < 6u; index += 1u) {
    if (index >= entries) { break; }
    let amount = i32(clamp(compositionValue(input.countsA, input.countsB, index) + 0.5, 1.0, 999.0));
    let kind = i32(compositionValue(input.kindsA, input.kindsB, index) + 0.5);
    let column = index % 2u;
    let row = index / 2u;
    var centerX = select(-0.34, 0.34, column == 1u);
    if (entries % 2u == 1u && index + 1u == entries) { centerX = 0.0; }
    let centerY = startY - f32(row) * 0.44;
    let icon = unitKindIcon(kind, squareLocal(
      uv, vec2f(centerX - 0.12, centerY + 0.015), input.panelHalf,
      6.8 * uniforms.viewport.z,
    ));
    let digits = amountCoverage(
      amount, uv, vec2f(centerX + 0.14, centerY), input.panelHalf,
      1.22 * uniforms.viewport.z,
    );
    rgb = mix(rgb, vec3f(0.94, 0.92, 0.82), clamp(icon, 0.0, 1.0) * plateCoverage);
    rgb = mix(rgb, vec3f(0.99, 0.98, 0.93), clamp(digits, 0.0, 1.0) * plateCoverage);
  }

  let barY = -0.79;
  let inBarBand = step(abs(uv.y - barY), 0.045) * step(abs(uv.x), 0.66) * plateCoverage;
  let filled = step(uv.x, -0.66 + 1.32 * input.health);
  let barCol = mix(vec3f(0.86, 0.24, 0.16), vec3f(0.42, 0.78, 0.34), input.health);
  rgb = mix(rgb, vec3f(0.05), inBarBand * (1.0 - filled) * 0.82);
  rgb = mix(rgb, barCol, inBarBand * filled);

  rgb = mix(rgb, vec3f(1.0, 0.92, 0.55), selectedRing);
  let coverage = max(plateCoverage, selectedRing);
  return vec4f(rgb, coverage * 0.98 * input.alpha);
}

@fragment
fn armyMarkerFragment(input: ArmyOut) -> @location(0) vec4f {
  if (input.alpha < 0.01) { discard; }
  let uv = input.uv; // -1..1 across the plaque
  if (input.state > 3.5) {
    // Rally point: a filled brass diamond with a dark rim, constant on-screen
    // size, so it holds contrast against terrain at full strategic zoom (F15c).
    let d = abs(uv.x) + abs(uv.y);
    let fill = 1.0 - smoothstep(0.74, 0.82, d);
    let rim = smoothstep(0.80, 0.86, d) * (1.0 - smoothstep(0.94, 1.02, d));
    let a = max(fill, rim);
    if (a < 0.02) { discard; }
    let col = mix(vec3f(0.05, 0.05, 0.04), vec3f(0.99, 0.83, 0.42), fill);
    return vec4f(col, a * 0.95 * input.alpha);
  }
  if (input.state > 2.5) {
    let radius = length(uv);
    let angle = atan2(uv.y, uv.x);
    let dash = step(0.42, fract((angle + 3.14159265) * 7.0));
    let ring = (1.0 - smoothstep(0.018, 0.035, abs(radius - 0.985))) * dash;
    if (ring < 0.02) { discard; }
    return vec4f(vec3f(0.94, 0.82, 0.48), ring * 0.78);
  }

  let contact = input.state > 1.5;
  let bodyCol = select(input.rgb, vec3f(0.42), contact);
  let plateUv = vec2f(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5);
  // textureSampleLevel (not textureSample): this fragment has already taken
  // conditional discards/returns above, so implicit-derivative sampling is not
  // in uniform control flow. The plate is a fixed-size HUD sprite — LOD 0 is fine.
  let plate = textureSampleLevel(armyMarkerPlate, armyMarkerPlateSampler, plateUv, 0.0);
  let expandedUv = vec2f(uv.x * 0.46 + 0.5, 0.5 - uv.y * 0.46);
  let expandedAlpha = textureSampleLevel(armyMarkerPlate, armyMarkerPlateSampler, expandedUv, 0.0).a;
  let selectedRing = max(0.0, expandedAlpha - plate.a) * input.selected;
  let plateCoverage = plate.a;
  if (plateCoverage + selectedRing < 0.02) { discard; }

  // The painted texture provides the physical counter. Country colour is an
  // inset signal rather than the entire background, so pale flags cannot wash
  // out the live white silhouette and count.
  var rgb = mix(plate.rgb * 0.88, plate.rgb * 0.72 + bodyCol * 0.28, plateCoverage * 0.25);
  if (contact) {
    let gray = dot(rgb, vec3f(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3f(gray), 0.78);
  }

  // Like Call of War's compact counters, the main plaque combines the two
  // largest unit types with their own amounts. Selecting it at close range
  // opens the companion manifest with all six exact categories.
  var liveMarks = 0.0;
  if (contact) {
    liveMarks = glyphCoveragePx(
      10, uv, vec2f(0.0, 0.05), input.panelHalf, 2.05 * uniforms.viewport.z,
    );
  } else {
    let shownRows = min(2u, u32(input.rows + 0.5));
    for (var index = 0u; index < 2u; index += 1u) {
      if (index >= shownRows) { break; }
      let centerX = select(0.0, -0.30 + f32(index) * 0.60, shownRows > 1u);
      let amount = i32(clamp(compositionValue(input.countsA, input.countsB, index) + 0.5, 1.0, 999.0));
      let kind = i32(compositionValue(input.kindsA, input.kindsB, index) + 0.5);
      let icon = unitKindIcon(kind, squareLocal(
        uv, vec2f(centerX, 0.19), input.panelHalf, 6.4 * uniforms.viewport.z,
      ));
      let digits = amountCoverage(
        amount, uv, vec2f(centerX, -0.13), input.panelHalf, 1.22 * uniforms.viewport.z,
      );
      liveMarks = max(liveMarks, clamp(icon + digits, 0.0, 1.0));
    }
  }
  let liveInk = vec3f(0.98, 0.97, 0.89);
  rgb = mix(rgb, vec3f(0.025), liveMarks * plateCoverage * 0.58);
  rgb = mix(rgb, liveInk, liveMarks * plateCoverage);

  // A thick, threshold-coloured condition strip fills the plate's recessed
  // channel. Unknown contacts keep a neutral channel instead of implying 0 HP.
  let barY = -0.61;
  let inBarBand = step(abs(uv.y - barY), 0.065) * step(abs(uv.x), 0.56) * plateCoverage;
  let filled = step(uv.x, -0.56 + 1.12 * input.health);
  var barCol = mix(vec3f(0.73, 0.19, 0.14), vec3f(0.76, 0.49, 0.16), step(0.34, input.health));
  barCol = mix(barCol, vec3f(0.37, 0.68, 0.28), step(0.67, input.health));
  rgb = mix(rgb, vec3f(0.025), inBarBand * 0.90);
  rgb = mix(rgb, barCol, inBarBand * filled * select(1.0, 0.0, contact));
  rgb = mix(rgb, vec3f(0.34), inBarBand * select(0.0, 0.72, contact));

  // An engaged formation gets a compact command jewel instead of another
  // rectangular tab layered over the painted cartouche.
  let engagedPixel = (uv - vec2f(0.72, 0.50)) * input.panelHalf;
  let engagedJewel = (1.0 - smoothstep(2.8, 4.0, length(engagedPixel))) * input.engaged * plateCoverage;
  rgb = mix(rgb, vec3f(0.76, 0.18, 0.12), engagedJewel * 0.92);

  rgb = mix(rgb, vec3f(1.0, 0.92, 0.55), selectedRing);

  // Cluster marker: a small brass "stack" mark (three short bars) in the
  // top-left corner so an aggregated count reads as "more than one stack"
  // rather than a single very large force (F2).
  if (input.cluster > 0.5) {
    let s = uniforms.viewport.z;
    let p = (uv - vec2f(-0.62, 0.5)) * input.panelHalf;
    let inBox = step(abs(p.x), 6.0 * s) * step(abs(p.y), 6.0 * s);
    let bars = step(0.45, fract((p.y + 6.0 * s) / (4.0 * s)));
    let cue = inBox * bars * plateCoverage;
    rgb = mix(rgb, vec3f(0.025), cue);
    rgb = mix(rgb, vec3f(0.98, 0.84, 0.42), cue);
  }

  let coverage = max(plateCoverage, selectedRing);

  return vec4f(rgb, coverage * 0.98 * input.alpha);
}
`;
