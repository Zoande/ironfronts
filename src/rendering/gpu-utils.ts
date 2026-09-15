import type { BinaryField } from './types';

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function align4(value: number): number {
  return (value + 3) & ~3;
}

export function uploadTexture(
  device: GPUDevice,
  label: string,
  width: number,
  height: number,
  format: GPUTextureFormat,
  bytes: Uint8Array,
  bytesPerRow: number,
): GPUTexture {
  const texture = device.createTexture({
    label,
    size: [width, height],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    bytes.buffer as ArrayBuffer,
    { offset: bytes.byteOffset, bytesPerRow, rowsPerImage: height },
    [width, height],
  );
  return texture;
}

export function uploadMipmappedTexture(
  device: GPUDevice,
  label: string,
  field: BinaryField,
  bytes: Uint8Array,
): GPUTexture {
  const mipLevelCount = field.mipLevelCount ?? 1;
  const texture = device.createTexture({
    label,
    size: [field.width, field.height],
    format: field.format as GPUTextureFormat,
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let width = field.width;
  let height = field.height;
  let offset = 0;
  for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel += 1) {
    const byteLength = width * height * 4;
    device.queue.writeTexture(
      { texture, mipLevel },
      bytes.buffer as ArrayBuffer,
      { offset: bytes.byteOffset + offset, bytesPerRow: width * 4, rowsPerImage: height },
      [width, height],
    );
    offset += byteLength;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
  if (offset !== bytes.byteLength) {
    throw new Error(`${label} mip data size mismatch: used ${offset}, received ${bytes.byteLength}`);
  }
  return texture;
}
