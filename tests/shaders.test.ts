import { describe, expect, it } from 'vitest';
import { WgslReflect } from 'wgsl_reflect/wgsl_reflect.module.js';
import { create, globals } from 'webgpu';
import {
  armyMarkerShader, armyModelShader, cityLightShader, combatEffectShader, countryLabelShader, infrastructureShader, lineShader, mapMarkerShader, polarCapShader, propShader,
  rainShader, terrainShader, waterShader, waterwayShader,
} from '../src/shaders';

describe('WGSL programs', () => {
  it('crossfades army models into dominant-type counters and hides the far LOD', () => {
    expect(armyModelShader).toContain('smoothstep(1500.0, 1900.0, uniforms.interaction.y)');
    expect(armyModelShader).toContain('fn armyKindCountVertex');
    expect(armyModelShader).toContain('mix(model.c.xy, model.a.xy, motion)');
    expect(armyMarkerShader).toContain('fn dominantIcon');
    expect(armyMarkerShader).toContain('fn armyCompositionVertex');
    expect(armyMarkerShader).toContain('fn armyCompositionFragment');
    expect(armyMarkerShader).toContain('smoothstep(4400.0, 5000.0, zoom)');
  });

  it('keeps strategic troop models small relative to roads and towns', () => {
    const scale = Number(/let scale = ([\d.]+);/.exec(armyModelShader)?.[1]);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(2.1);
  });

  it('pulls towns and forests down to a strategic map scale', () => {
    const footprint = Number(/BUILDING_FOOTPRINT_SCALE = ([\d.]+)/.exec(propShader)?.[1]);
    const tree = Number(/TREE_MAP_SCALE = ([\d.]+)/.exec(propShader)?.[1]);
    expect(footprint).toBeGreaterThan(0);
    expect(footprint).toBeLessThanOrEqual(0.45);
    expect(tree).toBeLessThanOrEqual(0.75);
    // landmark buildings keep more of their bulk so a capital still reads
    expect(propShader).toContain('archetype == 4u');
  });

  it('draws order routes as a terrain-draped line mode with move / attack / rally / retreat colours and an end chevron', () => {
    expect(lineShader).toContain('lineParams.mode == 3u');
    // draped along terrain, not floating at a fixed height
    expect(lineShader).toMatch(/mode == 3u\)?\s*\{[\s\S]*heightAt\(uv0\) \+ 2\.1/);
    // move (default) vs attack vs rally, plus a retreat override branch
    expect(lineShader).toContain('if (line.b.x > 1.5)');
    expect(lineShader).toMatch(/line\.b\.x > 0\.5/);
    expect(lineShader).toContain('if (line.b.z > 0.5)');
    // destination chevron segments are drawn bolder
    expect(lineShader).toContain('if (line.b.w > 0.5)');
  });

  it('limits beach material to the actual shoreline mask', () => {
    expect(terrainShader).toContain('let bankField = bankFieldAt(input.mapUv)');
    expect(terrainShader).toContain('let shoreline = bankField.g');
    expect(terrainShader).toContain('bankField.r <= 0.5');
    expect(terrainShader).not.toContain('if (elevation < 12.0)');
  });

  it('hands the landAt == 0.5 coast contour to exactly one of the terrain / water passes', () => {
    // Terrain discards at landAt <= 0.5; water must discard strictly above
    // 0.5 (not >=) so the interpolated 0.5 contour is drawn by the water
    // pass instead of being discarded by both — the hairline-gap half of the
    // Ultra blocky-black-coast artefact.
    expect(terrainShader).toContain('bankField.r <= 0.5');
    expect(waterShader).toContain('if (landAt(input.mapUv) > 0.5)');
    expect(waterShader).not.toMatch(/landAt\(input\.mapUv\) >= 0\.5/);
  });

  it('clips only the guarded river core while explicit water covers the wider contour', () => {
    const terrainFragment = terrainShader.slice(terrainShader.indexOf('@fragment\nfn terrainFragment'));
    expect(terrainFragment).toContain('riverField.r > 0.60 || riverField.g > 0.60');
    expect(waterShader).toContain('riverField.r > 0.45 || riverField.g > 0.45');
    expect(terrainShader).toContain('bankField.g');
    expect(terrainShader).toContain('shoreline * 0.72');
    expect(waterShader).toContain('oceanSurfaceColor(input.worldPosition');
    expect(waterShader).not.toContain('if (provinceAt(input.mapUv)');
  });

  it('tightens the shallow shelf and shoreline foam at every zoom and collapses them at overview', () => {
    expect(waterShader).toContain('let overview = smoothstep(2400.0, 6800.0, uniforms.interaction.y)');
    expect(waterShader).toContain('smoothstep(0.0, mix(0.44, 0.12, overview), depth)');
    expect(waterShader).toContain('color = mix(color, deep, 0.32)');
    expect(waterShader).toContain('color = mix(color, deep, overview * 0.45)');
    expect(waterShader).toContain('mix(0.55, 0.12, overview)');
  });

  it('renders suppressed-road geometry as floating dotted connectors', () => {
    expect(infrastructureShader).toContain('dotted && fract(input.roadUv.x / 6.4) > 0.40');
    expect(infrastructureShader).toContain('vec3f(0.96, 0.73, 0.25)');
    expect(infrastructureShader).not.toContain('infrastructureLevel');
    expect(infrastructureShader).not.toContain('corridorId');
  });

  it('renders supplied waterways with subtle flow-aligned motion and gives canals the ocean palette', () => {
    const fragment = waterwayShader.slice(waterwayShader.indexOf('@fragment\nfn waterwayFragment'));
    expect(fragment).toContain('uniforms.sunTime.w * input.speed');
    expect(fragment).toContain('let flowShimmer =');
    expect(waterwayShader).toContain('let flow = normalize(input.flow');
    expect(waterwayShader).toContain('let visualRiver = input.kind > 0.1 && input.kind < 0.5');
    expect(waterwayShader).toContain('visualRiverAt(mapUv)');
    expect(waterwayShader).toContain('fwidth(visualSignal)');
    expect(waterwayShader).toContain('if (visualSignal < 0.24) { discard; }');
    expect(waterwayShader).toContain('smoothstep(0.24, 0.52, visualSignal + visualAntialias * 0.5)');
    expect(waterwayShader).toContain('let swell = sin(alongFlow * 0.032');
    expect(fragment).not.toContain('brokenStreak');
    expect(waterwayShader).toContain('let canal = input.kind > 0.5');
    expect(waterwayShader).toContain('let coastShallow = vec3f(0.12, 0.48, 0.52)');
    expect(waterwayShader).toContain('let coastDeep = vec3f(0.025, 0.16, 0.255)');
    expect(waterwayShader).toContain('normalize(cross(screenDy, screenDx))');
    expect(waterwayShader).toContain('!canal && uniforms.interaction.w > 0.5');
    expect(waterwayShader).toContain('leftCountry.a > 0.0 && rightCountry.a > 0.0');
    expect(waterwayShader).toContain('let dashVisible = fract(input.waterUv.x) < 0.54');
    expect(terrainShader).toContain('let riverField = navigation.ba');
    expect(terrainShader).toContain('debugMode == 6u');
    expect(terrainShader).toContain('debugMode == 9u');
    expect(lineShader).toContain('lineParams.mode == 2u');
  });

  it('morphs five tree silhouettes and samples compact bark and foliage materials', () => {
    expect(propShader).toContain('fn treePartCenter(variant: u32, part: u32)');
    expect(propShader).toContain('min(u32(record.a.w + 0.5), 4u)');
    expect(propShader).toContain('treePartVisible(variant, part)');
    expect(propShader).toContain('textureSampleLevel(treeMaterialTexture');
    expect(propShader).toContain('clamp(record.b.w, 0.0, 1.0)');
    expect(propShader).not.toContain('input.materialPart > 8.5');
  });

  it('thins and flattens city buildings at regional zoom while keeping the landmark archetype', () => {
    expect(propShader).toContain('var buildingLod = 1.0;');
    expect(propShader).toContain('let regionalLod = smoothstep(1400.0, 2800.0, uniforms.interaction.y)');
    expect(propShader).toContain('if (archetype != 4u) {');
    expect(propShader).toContain('local.y *= mix(1.0, 0.5, regionalLod)');
    expect(propShader).toContain('let lodHash = noiseHash(vec2f(f32(visibleInstance % count), 7.31))');
    expect(propShader).toContain('buildingLod = 1.0 - smoothstep(lodStart, lodStart + 0.25, regionalLod) * 0.6');
    expect(propShader).toContain(') * buildingLod;');
  });

  it('uses precomputed terrain normals, faithful mipmapped albedo, prop AO, and packed navigation', () => {
    expect(terrainShader).toContain('let navigation = navigationAt(input.mapUv)');
    expect(terrainShader).toContain('let bakedSurface = textureSample(terrainAlbedoTexture');
    expect(terrainShader).toContain('fn surfaceTransitionAt');
    expect(terrainShader).toContain('surfaceTransition * 0.92');
    expect(terrainShader).toContain('baseColor *= bakedSurface.a');
    expect(terrainShader).toContain('smoothstep(3000.0, 4500.0');
    expect(terrainShader).not.toContain('textureSampleLevel(terrainAlbedoTexture');
  });

  it('derives political tint and country borders from mutable province ownership', () => {
    expect(terrainShader).toContain('let politicalColor = politicalColorAt(input.mapUv)');
    expect(terrainShader).toContain('diplomacyColor.rgb, isPlayer || hasRelationship || diplomacyMode');
    expect(terrainShader).toContain('diplomacyColor.rgb * 1.30');
    expect(terrainShader).toContain('overlayStrength = max(overlayStrength, 0.30)');
    expect(terrainShader).toContain('let isPlayer = diplomacyColor.a > 0.25 && diplomacyColor.a < 0.75');
    expect(terrainShader).toContain('select(0.45, 0.85, uniforms.interaction.z > 1.5)');
    expect(terrainShader).toContain('overlayColor * (terrainLuminance / tintLuminance)');
    expect(terrainShader).toContain('var preservation = 1.0 - overview');
    expect(terrainShader).toContain('let biomeRetention = 0.20 * preservation');
    expect(terrainShader).toContain('preservation *= 0.70');
    expect(terrainShader).toContain('preservation *= 0.45');
    expect(terrainShader).toContain('overlayStrength = 0.85');
    expect(terrainShader).not.toContain('let provinceId = provinceAt(input.mapUv)');
    expect(terrainShader).toContain('smoothstep(\n        3000.0,\n        6500.0,\n        uniforms.camera.y');
    expect(terrainShader).toContain('let balancedStrength = mix(\n        0.10,\n        0.82,\n        overview');
    expect(terrainShader).toContain('balancedStrength,\n        0.85,\n        uniforms.interaction.z > 1.5');
    expect(terrainShader).toContain('fog * 0.39');
    expect(terrainShader).toContain('* select(overview * 0.82, 1.0, politicalMode || diplomacyMode)');
    expect(lineShader).toContain('let countryBoundary = line.b.z < 0.0 && line.b.y > 0.5');
    expect(lineShader).toContain('height0 = abs(line.b.z) + 0.8');
    expect(lineShader).toContain('(lineParams.enabled & 2u) != 0u');
    expect(lineShader).toContain('mix(0.60, 0.94, nearFactor)');
    expect(lineShader).toContain('if (riverSignal >= 0.15) { discard; }');
    expect(lineShader).toContain('styledColor = mix(input.outerColor, input.innerColor, centerCoverage)');
    expect(lineShader).toContain('mix(0.30, 0.10, nearFactor)');
  });

  it('ranks national over province borders at overview zoom without touching hover or other modes', () => {
    // The overview border-ranking block still skips hover; the reconciled
    // shader also skips a selected province (its border must not recede at
    // overview — in-game command UI v2), so match the stable prefix.
    expect(lineShader).toContain('if (lineParams.mode == 0u && !hovered');
    expect(lineShader).toContain('let overviewFade = smoothstep(3200.0, 7600.0, uniforms.interaction.y)');
    expect(lineShader).toContain('color.a = mix(color.a, 0.92, overviewFade * 0.6)');
    expect(lineShader).toContain('color.a *= mix(1.0, 0.22, overviewFade)');
    // The pre-existing near-zoom weights are still the baseline the fade builds on.
    expect(lineShader).toContain('mix(0.60, 0.94, nearFactor)');
    expect(lineShader).toContain('mix(0.30, 0.10, nearFactor)');
  });

  it('builds purely visual periodic polar shelves with water gaps and an outer fog', () => {
    expect(polarCapShader).toContain('const POLAR_CAP_DEPTH');
    expect(polarCapShader).toContain('let angle = mapX / uniforms.map.x * TAU');
    expect(polarCapShader).toContain('channelCut');
    expect(polarCapShader).toContain('let polarFog = smoothstep');
    expect(polarCapShader).toContain('valueNoise(input.worldPosition.xz / 150.0)');
    expect(polarCapShader).not.toContain('valueNoise(input.worldPosition.xz / 16.0)');
    expect(polarCapShader).not.toContain('provinceAt(input');
    expect(polarCapShader).not.toContain('navigationAt(input');
  });

  it('generates bounded world-space rain and terrain impacts without particle buffers or CPU state', () => {
    expect(rainShader).toContain('@builtin(instance_index) instanceIndex: u32');
    expect(rainShader).toContain('uniforms.sunTime.w * speed');
    expect(rainShader).toContain('uniforms.weather.x * strategicReadability');
    expect(rainShader).toContain('let ground = heightAt(mapUv)');
    expect(rainShader).toContain('uniforms.viewProjection * vec4f(topWorld');
    expect(rainShader).toContain('let impact = instanceIndex % 9u == 0u');
    expect(rainShader).toContain('output.landSurface = landAt(mapUv)');
    expect(rainShader).toContain('let ringRadius = mix(0.18, 0.78, input.impactAge)');
    expect(rainShader).toContain('let strategicLengthScale = clamp(uniforms.camera.y / 275.0, 1.0, 12.0)');
    expect(rainShader).toContain('let columnHeight = clamp(uniforms.camera.y * 0.90, 125.0, 6000.0)');
    expect(rainShader).not.toContain('@group(1)');
  });

  it.each([
    ['terrain', terrainShader, ['terrainVertex'], ['terrainFragment']],
    ['polar caps', polarCapShader, ['polarCapVertex'], ['polarCapFragment']],
    ['water', waterShader, ['waterVertex'], ['waterFragment']],
    ['waterways', waterwayShader, ['waterwayVertex'], ['waterwayFragment']],
    ['infrastructure', infrastructureShader, ['infrastructureVertex'], ['infrastructureFragment']],
    ['props', propShader, ['propVertex'], ['propFragment']],
    ['city lights', cityLightShader, ['cityLightVertex'], ['cityLightFragment']],
    ['rain', rainShader, ['rainVertex'], ['rainFragment']],
    ['lines', lineShader, ['lineVertex'], ['lineFragment']],
    ['army markers', armyMarkerShader,
      ['armyMarkerVertex', 'armyCompositionVertex'], ['armyCompositionFragment', 'armyMarkerFragment']],
    ['army models', armyModelShader, ['armyModelVertex', 'armyKindCountVertex'], ['armyModelFragment', 'armyKindCountFragment']],
    ['combat effects', combatEffectShader, ['combatEffectVertex'], ['combatEffectFragment']],
    ['country labels', countryLabelShader, ['countryLabelVertex'], ['countryLabelFragment']],
  ])('parses the %s shader and exposes its render entry points', (_name, source, vertexNames, fragmentNames) => {
    const reflection = new WgslReflect(source);
    expect(reflection.entry.vertex.map((entry) => entry.name)).toEqual(vertexNames);
    expect(reflection.entry.fragment.map((entry) => entry.name)).toEqual(fragmentNames);
    expect(reflection.getBindGroups().length).toBeGreaterThan(0);
  });

  it('passes Dawn WebGPU semantic compilation', async () => {
    Object.assign(globalThis, globals);
    const gpu = create([]);
    const adapter = await gpu.requestAdapter();
    if (!adapter && process.env.CI) {
      console.warn('Skipping Dawn semantic compilation: CI runner has no compatible Vulkan/Dawn adapter.');
      return;
    }
    expect(adapter).not.toBeNull();
    if (!adapter) return;
    const device = await adapter.requestDevice();
    const modules = new Map<string, GPUShaderModule>();
    for (const [label, source] of [
      ['terrain', terrainShader], ['polar caps', polarCapShader], ['water', waterShader], ['waterways', waterwayShader], ['infrastructure', infrastructureShader], ['props', propShader], ['city lights', cityLightShader], ['rain', rainShader], ['lines', lineShader], ['map markers', mapMarkerShader], ['army markers', armyMarkerShader], ['army models', armyModelShader], ['combat effects', combatEffectShader], ['country labels', countryLabelShader],
    ] as const) {
      const module = device.createShaderModule({ label, code: source });
      modules.set(label, module);
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === 'error');
      expect(errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`)).toEqual([]);
    }

    const common = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 6, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 7, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 9, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 12, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ] });
    const layer = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ] });
    const labelLayer = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ] });
    const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('infrastructure')!, entryPoint: 'infrastructureVertex', buffers: [{ arrayStride: 36, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('infrastructure')!, entryPoint: 'infrastructureFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('terrain')!, entryPoint: 'terrainVertex', buffers: [{ arrayStride: 12, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('terrain')!, entryPoint: 'terrainFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('polar caps')!, entryPoint: 'polarCapVertex', buffers: [{ arrayStride: 12, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('polar caps')!, entryPoint: 'polarCapFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('water')!, entryPoint: 'waterVertex', buffers: [{ arrayStride: 12, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('water')!, entryPoint: 'waterFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('waterways')!, entryPoint: 'waterwayVertex', buffers: [{ arrayStride: 40, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' },
        { shaderLocation: 2, offset: 20, format: 'float32' }, { shaderLocation: 3, offset: 24, format: 'float32' },
        { shaderLocation: 4, offset: 28, format: 'float32x2' }, { shaderLocation: 5, offset: 36, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('waterways')!, entryPoint: 'waterwayFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('props')!, entryPoint: 'propVertex', buffers: [{ arrayStride: 28, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' },
      ] }] },
      fragment: { module: modules.get('props')!, entryPoint: 'propFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil,
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('city lights')!, entryPoint: 'cityLightVertex' },
      fragment: { module: modules.get('city lights')!, entryPoint: 'cityLightFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' },
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common] }),
      vertex: { module: modules.get('rain')!, entryPoint: 'rainVertex' },
      fragment: { module: modules.get('rain')!, entryPoint: 'rainFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' },
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('lines')!, entryPoint: 'lineVertex' },
      fragment: { module: modules.get('lines')!, entryPoint: 'lineFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' }, depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'less-equal' },
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('map markers')!, entryPoint: 'mapMarkerVertex' },
      fragment: { module: modules.get('map markers')!, entryPoint: 'mapMarkerFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'always' },
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, layer] }),
      vertex: { module: modules.get('combat effects')!, entryPoint: 'combatEffectVertex' },
      fragment: { module: modules.get('combat effects')!, entryPoint: 'combatEffectFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'always' },
    })).resolves.toBeDefined();
    await expect(device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [common, labelLayer] }),
      vertex: { module: modules.get('country labels')!, entryPoint: 'countryLabelVertex' },
      fragment: { module: modules.get('country labels')!, entryPoint: 'countryLabelFragment', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { ...depthStencil, depthWriteEnabled: false, depthCompare: 'always' },
    })).resolves.toBeDefined();
    device.destroy();
  }, 20_000);
});
