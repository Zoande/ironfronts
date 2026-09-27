import { commonWgsl } from './common';

export const waterwayShader = commonWgsl + /* wgsl */ `
struct WaterwayInput {
  @location(0) position: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) kind: f32,
  @location(4) flow: vec2f,
  @location(5) speed: f32,
};

struct WaterwayOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) waterUv: vec2f,
  @location(2) edgeFactor: f32,
  @location(3) @interpolate(flat) kind: f32,
  @location(4) visibility: f32,
  @location(5) flow: vec2f,
  @location(6) speed: f32,
};

@vertex
fn waterwayVertex(input: WaterwayInput, @builtin(instance_index) instanceIndex: u32) -> WaterwayOutput {
  let copyOffset = f32(i32(instanceIndex) - 1) * uniforms.map.x;
  let worldPosition = input.position + vec3f(copyOffset, 0.0, 0.0);
  var output: WaterwayOutput;
  output.position = uniforms.viewProjection * vec4f(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.waterUv = input.waterUv;
  output.edgeFactor = input.edgeFactor;
  output.kind = input.kind;
  output.flow = input.flow;
  output.speed = input.speed;
  output.visibility = 1.0 - smoothstep(7600.0, 9200.0, distance(uniforms.camera.xyz, worldPosition));
  return output;
}

@fragment
fn waterwayFragment(input: WaterwayOutput) -> @location(0) vec4f {
  let longitudinalVariation = fwidth(input.waterUv.x);
  if (input.visibility < 0.02) { discard; }
  let mapUv = input.worldPosition.xz / uniforms.map.xy;
  let visualRiver = input.kind > 0.1 && input.kind < 0.5;
  let visualSignal = visualRiverAt(mapUv);
  let visualAntialias = clamp(fwidth(visualSignal) * 0.6, 0.008, 0.05);
  var visualCoverage = 1.0;
  if (visualRiver) {
    // The visual-river ribbon is a per-mask-texel quilt (buildVisualWaterways
    // emits one quad per active mask cell). A tight 0.45 gate re-clipped every
    // tile, so a diagonally running river read as a chain of detached blocks.
    // Gate at a fixed 0.24 (no per-pixel fwidth term - that was dithering the
    // edge into visible speckle) and fade over a wide 0.24..0.52 band so
    // adjacent tiles merge into one continuous channel; the ribbon geometry
    // still bounds it.
    if (visualSignal < 0.24) { discard; }
    visualCoverage = smoothstep(0.24, 0.52, visualSignal + visualAntialias * 0.5);
  }
  // Once an authored channel has entered broad static water, the ocean/lake
  // pass owns the surface. This removes distant source-graph tails while the
  // near-bank overlap still hides any seam at the mouth.
  if (landAt(mapUv) < 0.5 && bankAt(mapUv) < 0.035) { discard; }
  let canal = input.kind > 0.5;
  let debugMode = u32(uniforms.map.w + 0.5);
  if (debugMode == 6u) {
    let worldFog = mapFog(input.worldPosition.xz);
    return select(vec4f(0.02, 0.94, 1.0, 1.0 - worldFog), vec4f(0.98, 0.72, 0.10, 1.0 - worldFog), canal);
  }
  if (debugMode == 9u) {
    let worldFog = mapFog(input.worldPosition.xz);
    return select(vec4f(0.02, 0.78, 0.98, 1.0 - worldFog), vec4f(0.77, 0.42, 0.96, 1.0 - worldFog), canal);
  }
  let flow = normalize(input.flow + vec2f(0.00001, 0.0));
  let across = vec2f(-flow.y, flow.x);
  let screenDx = dpdx(input.worldPosition);
  let screenDy = dpdy(input.worldPosition);
  var normal = normalize(cross(screenDy, screenDx));
  if (normal.y < 0.0) { normal = -normal; }
  let depth = 0.08;
  let shelf = smoothstep(0.0, 0.44, depth);
  let coastShallow = vec3f(0.12, 0.48, 0.52);
  let coastDeep = vec3f(0.025, 0.16, 0.255);
  var color = mix(coastShallow, coastDeep, shelf);
  // Two inexpensive flow-aligned bands provide readable downstream motion
  // without displacing geometry or turning the river into a noisy surface.
  let alongFlow = dot(input.worldPosition.xz, flow);
  let acrossFlow = dot(input.worldPosition.xz, across);
  let flowTime = uniforms.sunTime.w * input.speed;
  // Per-river variation: input.speed shifts wave frequency and phase so no
  // two rivers pulse in lockstep. A slow swell rides under the two ripple
  // bands to give a streaming feel without a noisy surface.
  let riverPhase = input.speed * 11.3;
  let waveScale = 0.085 + input.speed * 0.06;
  let rippleA = sin(alongFlow * waveScale - flowTime * 0.78 + riverPhase + sin(acrossFlow * 0.16) * 0.40);
  let rippleB = sin(alongFlow * waveScale * 2.1 - flowTime * 1.31 - acrossFlow * 0.07 + riverPhase * 1.7);
  let swell = sin(alongFlow * 0.032 - flowTime * 0.34 + riverPhase);
  let flowShimmer = clamp(0.5 + rippleA * 0.30 + rippleB * 0.18 + swell * 0.12, 0.0, 1.0);
  let calmEdge = 1.0 - input.edgeFactor * 0.35;
  color *= 0.95 + flowShimmer * calmEdge * 0.085;
  color += vec3f(0.05, 0.075, 0.085) * smoothstep(0.70, 1.0, flowShimmer) * calmEdge;
  let viewDirection = normalize(uniforms.camera.xyz - input.worldPosition);
  let fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.5);
  let sun = pow(max(dot(reflect(-normalize(uniforms.sunTime.xyz), normal), viewDirection), 0.0), 112.0);
  color = mix(color, vec3f(0.40, 0.60, 0.63), fresnel * 0.64);
  let foamBreak = valueNoise(input.worldPosition.xz / 11.0);
  let foam = input.edgeFactor * smoothstep(0.54, 0.82, foamBreak);
  color = mix(color, vec3f(0.73, 0.82, 0.77), foam * 0.52);
  color += vec3f(1.0, 0.86, 0.61) * sun * 0.34 * uniforms.lighting.x;
  color *= mix(vec3f(0.27, 0.36, 0.56), vec3f(1.0), uniforms.lighting.x);
  color = mix(color, color * vec3f(0.72, 0.79, 0.83), uniforms.weather.x * 0.32);

  // River political borders belong to the supplied centerline, not either
  // bank. Sampling beyond both banks makes the line ownership-driven without
  // adding another mutable geometry buffer. Canals and open water never enter
  // this path, and constant-waterUv node caps are excluded with fwidth.
  if (!canal && uniforms.interaction.w > 0.5 && longitudinalVariation > 0.000001) {
    let bankSampleDistance = 14.0;
    let leftCountry = politicalColorAt((input.worldPosition.xz + across * bankSampleDistance) / uniforms.map.xy);
    let rightCountry = politicalColorAt((input.worldPosition.xz - across * bankSampleDistance) / uniforms.map.xy);
    let countriesDiffer = leftCountry.a > 0.0 && rightCountry.a > 0.0
      && abs(leftCountry.a - rightCountry.a) > 0.001;
    let dashVisible = fract(input.waterUv.x) < 0.54;
    if (countriesDiffer && dashVisible) {
      let centerDistance = abs(input.waterUv.y - 0.5);
      let casing = 1.0 - smoothstep(0.075, 0.13, centerDistance);
      let center = 1.0 - smoothstep(0.025, 0.065, centerDistance);
      color = mix(color, vec3f(0.035, 0.047, 0.043), casing * 0.90);
      color = mix(color, vec3f(0.77, 0.71, 0.57), center * 0.86);
    }
  }
  let fog = smoothstep(4000.0, 12000.0, distance(uniforms.camera.xyz, input.worldPosition));
  let worldFog = mapFog(input.worldPosition.xz);
  let foggedColor = mix(mix(color, distanceFogColor(), fog * 0.40), worldFogColor(), worldFog);
  return vec4f(foggedColor, input.visibility * visualCoverage * 0.985 * (1.0 - worldFog));
}
`;
