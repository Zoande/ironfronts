import {
  armyMarkerShader, armyModelShader, cityLightShader, combatEffectShader, countryLabelShader, infrastructureShader,
  lineShader, mapMarkerShader, polarCapShader, propShader, rainShader, terrainShader, waterShader, waterwayShader,
} from './shaders';

export interface RendererLayouts {
  common: GPUBindGroupLayout;
  instances: GPUBindGroupLayout;
  lines: GPUBindGroupLayout;
  countryLabels: GPUBindGroupLayout;
}

export interface RendererPipelines {
  terrain: GPURenderPipeline;
  polarCaps: GPURenderPipeline;
  water: GPURenderPipeline;
  waterways: GPURenderPipeline;
  infrastructure: GPURenderPipeline;
  props: GPURenderPipeline;
  cityLights: GPURenderPipeline;
  rain: GPURenderPipeline;
  lines: GPURenderPipeline;
  mapMarkers: GPURenderPipeline;
  armyMarkers: GPURenderPipeline;
  armyComposition: GPURenderPipeline;
  armyModels: GPURenderPipeline;
  armyKindCounts: GPURenderPipeline;
  combatEffects: GPURenderPipeline;
  countryLabels: GPURenderPipeline;
}

export function createRendererLayouts(device: GPUDevice): RendererLayouts {
  const common = device.createBindGroupLayout({
    label: 'common world layout',
    entries: [
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
    ],
  });
  const instances = device.createBindGroupLayout({
    label: 'instance layer layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const lines = device.createBindGroupLayout({
    label: 'line layer layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const countryLabels = device.createBindGroupLayout({
    label: 'country label layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  return { common, instances, lines, countryLabels };
}

export function createRendererPipelines(
  device: GPUDevice,
  format: GPUTextureFormat,
  layouts: RendererLayouts,
): RendererPipelines {
  const depthStencil: GPUDepthStencilState = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };
  const terrainModule = device.createShaderModule({ label: 'terrain shader', code: terrainShader });
  const polarCapModule = device.createShaderModule({ label: 'polar cap shader', code: polarCapShader });
  const waterModule = device.createShaderModule({ label: 'water shader', code: waterShader });
  const waterwayModule = device.createShaderModule({ label: 'static waterway shader', code: waterwayShader });
  const infrastructureModule = device.createShaderModule({ label: 'terrain-draped road shader', code: infrastructureShader });
  const propModule = device.createShaderModule({ label: 'prop shader', code: propShader });
  const cityLightModule = device.createShaderModule({ label: 'strategic city light shader', code: cityLightShader });
  const rainModule = device.createShaderModule({ label: 'procedural rain shader', code: rainShader });
  const lineModule = device.createShaderModule({ label: 'line shader', code: lineShader });
  const mapMarkerModule = device.createShaderModule({ label: 'strategic map marker shader', code: mapMarkerShader });
  const countryLabelModule = device.createShaderModule({ label: 'country label shader', code: countryLabelShader });
  const commonLayout = device.createPipelineLayout({ bindGroupLayouts: [layouts.common] });

  const terrain = device.createRenderPipeline({
    label: 'terrain pipeline', layout: commonLayout,
    vertex: { module: terrainModule, entryPoint: 'terrainVertex', buffers: [{ arrayStride: 12, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
    ] }] },
    fragment: { module: terrainModule, entryPoint: 'terrainFragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
  });
  const polarCaps = device.createRenderPipeline({
    label: 'visual polar caps pipeline', layout: commonLayout,
    vertex: { module: polarCapModule, entryPoint: 'polarCapVertex', buffers: [{ arrayStride: 12, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
    ] }] },
    fragment: { module: polarCapModule, entryPoint: 'polarCapFragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
  });
  const water = device.createRenderPipeline({
    label: 'water pipeline', layout: commonLayout,
    vertex: { module: waterModule, entryPoint: 'waterVertex', buffers: [{ arrayStride: 12, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32' },
    ] }] },
    fragment: { module: waterModule, entryPoint: 'waterFragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
  });
  const waterways = device.createRenderPipeline({
    label: 'static waterway pipeline', layout: commonLayout,
    vertex: { module: waterwayModule, entryPoint: 'waterwayVertex', buffers: [{ arrayStride: 40, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' },
      { shaderLocation: 2, offset: 20, format: 'float32' }, { shaderLocation: 3, offset: 24, format: 'float32' },
      { shaderLocation: 4, offset: 28, format: 'float32x2' }, { shaderLocation: 5, offset: 36, format: 'float32' },
    ] }] },
    fragment: { module: waterwayModule, entryPoint: 'waterwayFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      ...depthStencil,
      depthCompare: 'less-equal',
      depthBias: -1,
      depthBiasSlopeScale: -0.25,
    },
  });
  const infrastructure = device.createRenderPipeline({
    label: 'terrain-draped roads pipeline', layout: commonLayout,
    vertex: { module: infrastructureModule, entryPoint: 'infrastructureVertex', buffers: [{ arrayStride: 36, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32x2' }, { shaderLocation: 3, offset: 32, format: 'float32' },
    ] }] },
    fragment: { module: infrastructureModule, entryPoint: 'infrastructureFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil,
  });
  const props = device.createRenderPipeline({
    label: 'world props pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.instances] }),
    vertex: { module: propModule, entryPoint: 'propVertex', buffers: [{ arrayStride: 28, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'float32' },
    ] }] },
    fragment: { module: propModule, entryPoint: 'propFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' }, depthStencil,
  });
  const cityLights = device.createRenderPipeline({
    label: 'strategic city lights pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.instances] }),
    vertex: { module: cityLightModule, entryPoint: 'cityLightVertex' },
    fragment: { module: cityLightModule, entryPoint: 'cityLightFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  const rain = device.createRenderPipeline({
    label: 'procedural rain pipeline', layout: commonLayout,
    vertex: { module: rainModule, entryPoint: 'rainVertex' },
    fragment: { module: rainModule, entryPoint: 'rainFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  const lines = device.createRenderPipeline({
    label: 'map lines pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: lineModule, entryPoint: 'lineVertex' },
    fragment: { module: lineModule, entryPoint: 'lineFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const mapMarkers = device.createRenderPipeline({
    label: 'strategic map markers pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: mapMarkerModule, entryPoint: 'mapMarkerVertex' },
    fragment: { module: mapMarkerModule, entryPoint: 'mapMarkerFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const armyMarkerModule = device.createShaderModule({ label: 'army marker shader', code: armyMarkerShader });
  const armyMarkers = device.createRenderPipeline({
    label: 'army stack markers pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: armyMarkerModule, entryPoint: 'armyMarkerVertex' },
    fragment: { module: armyMarkerModule, entryPoint: 'armyMarkerFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const armyModelModule = device.createShaderModule({ label: 'procedural army model shader', code: armyModelShader });
  const armyModels = device.createRenderPipeline({
    label: 'close-range army models pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: armyModelModule, entryPoint: 'armyModelVertex' },
    fragment: { module: armyModelModule, entryPoint: 'armyModelFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
  });
  const armyKindCounts = device.createRenderPipeline({
    label: 'close-range army kind count pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: armyModelModule, entryPoint: 'armyKindCountVertex' },
    fragment: { module: armyModelModule, entryPoint: 'armyKindCountFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const armyComposition = device.createRenderPipeline({
    label: 'close-range army composition marker pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: armyMarkerModule, entryPoint: 'armyCompositionVertex' },
    fragment: { module: armyMarkerModule, entryPoint: 'armyCompositionFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const combatEffectModule = device.createShaderModule({ label: 'combat effect shader', code: combatEffectShader });
  const combatEffects = device.createRenderPipeline({
    label: 'world-space combat effects pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.lines] }),
    vertex: { module: combatEffectModule, entryPoint: 'combatEffectVertex' },
    fragment: { module: combatEffectModule, entryPoint: 'combatEffectFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });
  const countryLabels = device.createRenderPipeline({
    label: 'country label pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.common, layouts.countryLabels] }),
    vertex: { module: countryLabelModule, entryPoint: 'countryLabelVertex' },
    fragment: { module: countryLabelModule, entryPoint: 'countryLabelFragment', targets: [{ format, blend: alphaBlend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  });
  return {
    terrain, polarCaps, water, waterways, infrastructure, props, cityLights, rain, lines, mapMarkers, armyMarkers,
    armyComposition, armyModels, armyKindCounts, combatEffects,
    countryLabels,
  };
}

const alphaBlend: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};
