import { commonWgsl } from './common';

export const lineShader = commonWgsl + /* wgsl */ `
struct LineRecord { a: vec4f, b: vec4f };
struct LineParams { count: u32, mode: u32, enabled: u32, padding: u32 };
@group(1) @binding(0) var<storage, read> lines: array<LineRecord>;
@group(1) @binding(1) var<uniform> lineParams: LineParams;

struct LineOutput {
  @builtin(position) position: vec4f,
  @location(0) outerColor: vec4f,
  @location(1) fogVisibility: f32,
  @location(2) innerColor: vec4f,
  @location(3) lineSide: f32,
  @location(4) @interpolate(flat) countryCasing: f32,
  @location(5) mapUv: vec2f,
  @location(6) @interpolate(flat) borderMode: f32,
};

@vertex
fn lineVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> LineOutput {
  let copyIndex = instanceIndex / lineParams.count;
  let line = lines[instanceIndex % lineParams.count];
  let copyOffset = f32(i32(copyIndex) - 1) * uniforms.map.x;
  let uv0 = vec2f(line.a.x / uniforms.map.x, line.a.y / uniforms.map.y);
  let uv1 = vec2f(line.a.z / uniforms.map.x, line.a.w / uniforms.map.y);
  var height0 = 0.0;
  var height1 = 0.0;
  if (lineParams.mode == 0u) {
    height0 = abs(line.b.z) + 0.8;
    height1 = line.b.w + 1.8;
  } else if (lineParams.mode == 1u) {
    height0 = heightAt(uv0) + 1.8;
    height1 = heightAt(uv1) + 1.8;
    if (line.b.x < 0.5) {
      height0 = 1.7;
      height1 = 1.7;
    }
  } else if (lineParams.mode == 2u) {
    height0 = line.b.x + 2.35;
    height1 = line.b.y + 2.35;
  } else if (lineParams.mode == 3u) {
    // Order route: drape along the terrain a touch above the road surface.
    height0 = heightAt(uv0) + 2.1;
    height1 = heightAt(uv1) + 2.1;
  }
  let world0 = vec3f(line.a.x + copyOffset, height0, line.a.y);
  let world1 = vec3f(line.a.z + copyOffset, height1, line.a.w);
  let clip0 = uniforms.viewProjection * vec4f(world0, 1.0);
  let clip1 = uniforms.viewProjection * vec4f(world1, 1.0);
  let ndc0 = clip0.xy / clip0.w;
  let ndc1 = clip1.xy / clip1.w;
  let direction = normalize(ndc1 - ndc0 + vec2f(0.000001, 0.0));
  let normal = vec2f(-direction.y, direction.x);

  let endpoint = array<u32, 6>(0u, 1u, 0u, 0u, 1u, 1u)[vertexIndex];
  let side = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0)[vertexIndex];
  let hoverId = uniforms.interaction.x;
  let hovered = hoverId > 0.5 && (abs(line.b.x - hoverId) < 0.5 || abs(line.b.y - hoverId) < 0.5);
  // weather.w carries the encoded selected province id (0 = none). A selected
  // province gets the strongest border treatment in the hierarchy: above
  // hover, and it does not recede at overview zoom.
  let selectedId = uniforms.weather.w;
  let selected = selectedId > 0.5 && (abs(line.b.x - selectedId) < 0.5 || abs(line.b.y - selectedId) < 0.5);
  let nearFactor = 1.0 - smoothstep(700.0, 8200.0, uniforms.interaction.y);
  var widthPixels = 0.72 + nearFactor * 0.8;
  var color = vec4f(0.055, 0.085, 0.077, mix(0.30, 0.10, nearFactor));
  var innerColor = color;
  var countryCasing = 0.0;
  if (line.b.y < 0.5) { color.a *= 0.46; }
  if (lineParams.mode == 0u) {
    let provinceBordersVisible = (lineParams.enabled & 1u) != 0u;
    let countryBordersVisible = (lineParams.enabled & 2u) != 0u;
    // A coastline has no province on its far side. Do not promote it to a
    // political boundary merely because its implicit owner differs.
    let countryBoundary = line.b.z < 0.0 && line.b.y > 0.5;
    if (countryBoundary && countryBordersVisible) {
      widthPixels = 2.65 - nearFactor * 0.58;
      color = vec4f(0.035, 0.047, 0.043, mix(0.60, 0.94, nearFactor));
      innerColor = vec4f(0.77, 0.71, 0.57, mix(0.52, 0.86, nearFactor));
      countryCasing = 1.0;
    } else if (!provinceBordersVisible) {
      color.a = 0.0;
    }
    if (hovered && (provinceBordersVisible || countryBordersVisible)) {
      widthPixels = max(widthPixels, 2.8);
      color = vec4f(0.96, 0.78, 0.35, 0.96);
      innerColor = color;
      countryCasing = 0.0;
    }
    if (selected && (provinceBordersVisible || countryBordersVisible)) {
      widthPixels = max(widthPixels + nearFactor * 0.6, 3.6);
      color = vec4f(0.04, 0.05, 0.05, 0.98);
      innerColor = vec4f(0.99, 0.9, 0.62, 1.0);
      countryCasing = 1.0;
    }
  } else if (lineParams.mode == 1u) {
    widthPixels = 1.1;
    color = select(vec4f(0.19, 0.64, 0.78, 0.68), vec4f(0.80, 0.67, 0.25, 0.72), line.b.x > 0.5);
  } else if (lineParams.mode == 2u) {
    widthPixels = 2.1 + nearFactor * 0.75;
    color = select(vec4f(0.05, 0.91, 1.0, 0.94), vec4f(0.98, 0.71, 0.12, 0.96), line.b.z > 0.5);
  } else if (lineParams.mode == 3u) {
    // Order route. b.x: 0 move (cream) / 1 attack (muted red) / 2 rally (blue);
    // b.z > 0.5 retreat (amber, overrides); b.w > 0.5 = destination chevron.
    widthPixels = 1.9 + nearFactor * 1.0;
    var routeColor = vec4f(0.94, 0.89, 0.74, 0.92);
    if (line.b.x > 1.5) { routeColor = vec4f(0.42, 0.66, 0.95, 0.88); }
    else if (line.b.x > 0.5) { routeColor = vec4f(0.82, 0.30, 0.24, 0.94); }
    if (line.b.z > 0.5) { routeColor = vec4f(0.92, 0.62, 0.24, 0.94); }
    if (line.b.w > 0.5) { widthPixels += 1.4; routeColor.a = min(1.0, routeColor.a + 0.06); }
    color = routeColor;
    innerColor = routeColor;
  }

  // Line hierarchy at overview zoom (uniforms.interaction.y is the camera
  // orbit distance). National borders must stay legible when zoomed out;
  // province borders are secondary and should recede so political structure
  // reads at a glance, then return progressively toward regional zoom.
  // Hovered lines and non-border modes keep their own styling.
  if (lineParams.mode == 0u && !hovered && !selected) {
    let overviewFade = smoothstep(3200.0, 7600.0, uniforms.interaction.y);
    if (countryCasing > 0.5) {
      widthPixels += overviewFade * 0.5;
      color.a = mix(color.a, 0.92, overviewFade * 0.6);
      innerColor.a = mix(innerColor.a, 0.95, overviewFade * 0.6);
    } else {
      color.a *= mix(1.0, 0.22, overviewFade);
    }
  }

  let clip = select(clip0, clip1, endpoint == 1u);
  let pixelOffset = normal * side * widthPixels * 2.0 / uniforms.viewport.xy;
  var output: LineOutput;
  output.position = clip + vec4f(pixelOffset * clip.w, 0.0, 0.0);
  output.outerColor = color;
  output.fogVisibility = 1.0 - horizontalWorldFog(select(world0.x, world1.x, endpoint == 1u));
  output.innerColor = innerColor;
  output.lineSide = side;
  output.countryCasing = countryCasing;
  output.mapUv = select(uv0, uv1, endpoint == 1u);
  output.borderMode = select(0.0, 1.0, lineParams.mode == 0u);
  return output;
}

@fragment
fn lineFragment(input: LineOutput) -> @location(0) vec4f {
  let distanceFromCenter = abs(input.lineSide);
  let centerCoverage = 1.0 - smoothstep(0.43, 0.55, distanceFromCenter);
  let edgeCoverage = 1.0 - smoothstep(0.88, 1.0, distanceFromCenter);
  if (input.borderMode > 0.5) {
    let riverSignal = max(waterwayAt(input.mapUv), visualRiverAt(input.mapUv));
    // The river surface owns political boundaries over water. Suppressing the
    // ordinary geometry prevents a separate line from appearing on each bank.
    if (riverSignal >= 0.15) { discard; }
  }
  var styledColor = input.outerColor;
  if (input.countryCasing > 0.5) {
    styledColor = mix(input.outerColor, input.innerColor, centerCoverage);
  }
  let color = vec4f(styledColor.rgb, styledColor.a * input.fogVisibility * edgeCoverage);
  if (color.a < 0.002) { discard; }
  return color;
}
`;
