const MATERIAL_NAMES = ['grassland', 'dry-earth', 'desert-sand', 'forest-floor', 'exposed-rock', 'tundra-snow', 'urban-ground', 'shoreline'];
const FALLBACK_COLORS = ['#718456', '#987e55', '#bba36b', '#43533a', '#77736b', '#a9aaa0', '#68665f', '#bea978'];
const TREE_MATERIAL_NAMES = ['tree-leaves-light', 'tree-leaves-dark', 'tree-bark'];
const TREE_FALLBACK_COLORS = ['#4f7d2f', '#183f2b', '#704523'];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export async function createMaterialTexture(device: GPUDevice): Promise<GPUTexture> {
  return createTextureArray(device, 'terrain material array', MATERIAL_NAMES, FALLBACK_COLORS, 512);
}

export async function createTreeMaterialTexture(device: GPUDevice): Promise<GPUTexture> {
  return createTextureArray(device, 'tree material array', TREE_MATERIAL_NAMES, TREE_FALLBACK_COLORS, 256);
}

async function createTextureArray(
  device: GPUDevice,
  label: string,
  names: string[],
  fallbackColors: string[],
  size: number,
): Promise<GPUTexture> {
  const mipLevelCount = Math.floor(Math.log2(size)) + 1;
  const texture = device.createTexture({
    label,
    size: [size, size, names.length],
    format: 'rgba8unorm-srgb',
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  for (let layer = 0; layer < names.length; layer += 1) {
    let source: ImageBitmap;
    try {
      const response = await fetch(`/textures/${names[layer]}.png`);
      if (!response.ok) throw new Error(String(response.status));
      source = await createImageBitmap(await response.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
    } catch {
      source = await createFallbackMaterial(size, fallbackColors[layer], layer);
    }
    device.queue.copyExternalImageToTexture({ source }, { texture, origin: [0, 0, layer] }, [size, size]);
    source.close();
  }
  generateMipmaps(device, texture, names.length, mipLevelCount);
  return texture;
}

function generateMipmaps(device: GPUDevice, texture: GPUTexture, layers: number, mipLevelCount: number): void {
  const module = device.createShaderModule({ label: 'material mipmap shader', code: /* wgsl */ `
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var sourceSampler: sampler;

    struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f };

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Output {
      let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: Output;
      output.position = vec4f(positions[index], 0.0, 1.0);
      output.uv = output.position.xy * vec2f(0.5, -0.5) + 0.5;
      return output;
    }

    @fragment fn fragmentMain(input: Output) -> @location(0) vec4f {
      return textureSample(sourceTexture, sourceSampler, input.uv);
    }
  ` });
  const pipeline = device.createRenderPipeline({
    label: 'material mipmap pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain' },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm-srgb' }] },
    primitive: { topology: 'triangle-list' },
  });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const encoder = device.createCommandEncoder({ label: 'generate material mipmaps' });
  for (let layer = 0; layer < layers; layer += 1) {
    for (let mip = 1; mip < mipLevelCount; mip += 1) {
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView({ dimension: '2d', baseMipLevel: mip - 1, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }) },
          { binding: 1, resource: sampler },
        ],
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }),
          loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }
  }
  device.queue.submit([encoder.finish()]);
}

async function createFallbackMaterial(size: number, color: string, seed: number): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = color;
  context.fillRect(0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  let state = (seed + 1) * 0x9e3779b1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      const noise = ((state >>> 0) / 0xffffffff - 0.5) * 24;
      const index = (y * size + x) * 4;
      image.data[index] = clamp(image.data[index] + noise, 0, 255);
      image.data[index + 1] = clamp(image.data[index + 1] + noise, 0, 255);
      image.data[index + 2] = clamp(image.data[index + 2] + noise, 0, 255);
    }
  }
  context.putImageData(image, 0, 0);
  return createImageBitmap(canvas);
}
