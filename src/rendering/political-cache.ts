import type { WorldManifest } from './types';

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class PoliticalCache {
  readonly width: number;
  readonly height: number;
  readonly colors: Uint8Array;

  private readonly provinceIds: Uint16Array;
  private readonly bounds: Array<PixelBounds | undefined>;
  private readonly borderData: Float32Array;
  private readonly borderSegmentsByProvince: number[][];

  constructor(
    manifest: WorldManifest,
    provinceData: Uint16Array,
    private readonly provinceOwners: Uint32Array,
    private readonly countryColors: Float32Array,
    borderBuffer: ArrayBuffer,
  ) {
    this.width = manifest.fields.terrainAlbedo.width;
    this.height = manifest.fields.terrainAlbedo.height;
    this.colors = new Uint8Array(this.width * this.height * 4);
    this.provinceIds = new Uint16Array(this.width * this.height);
    this.bounds = new Array(provinceOwners.length);

    const sourceWidth = manifest.fields.provinceIds.width;
    const sourceHeight = manifest.fields.provinceIds.height;
    for (let y = 0; y < this.height; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / this.height));
      for (let x = 0; x < this.width; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / this.width));
        const index = y * this.width + x;
        const provinceId = provinceData[sourceY * sourceWidth + sourceX] ?? 0;
        this.provinceIds[index] = provinceId;
        if (provinceId > 0) this.expandBounds(provinceId, x, y);
        this.writePixel(index, provinceId);
      }
    }

    this.borderData = new Float32Array(borderBuffer);
    this.borderSegmentsByProvince = Array.from({ length: provinceOwners.length }, () => [] as number[]);
    for (let segment = 0; segment < manifest.buffers.borders.count; segment += 1) {
      const offset = segment * 8;
      const provinceA = Math.round(this.borderData[offset + 4]);
      const provinceB = Math.round(this.borderData[offset + 5]);
      if (provinceA < this.borderSegmentsByProvince.length) this.borderSegmentsByProvince[provinceA].push(segment);
      if (provinceB > 0 && provinceB < this.borderSegmentsByProvince.length) {
        this.borderSegmentsByProvince[provinceB].push(segment);
      }
      this.updateBorderSegment(segment);
    }
  }

  update(provinceIds: number[], device: GPUDevice, colorTexture: GPUTexture, borderBuffer: GPUBuffer): void {
    if (!provinceIds.length) return;
    const affectedSegments = new Set<number>();
    for (const provinceId of provinceIds) {
      const bounds = this.bounds[provinceId];
      if (bounds) {
        for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
          for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            const index = y * this.width + x;
            if (this.provinceIds[index] === provinceId) this.writePixel(index, provinceId);
          }
        }
        device.queue.writeTexture(
          { texture: colorTexture, origin: [bounds.minX, bounds.minY] },
          this.colors.buffer as ArrayBuffer,
          {
            offset: this.colors.byteOffset + (bounds.minY * this.width + bounds.minX) * 4,
            bytesPerRow: this.width * 4,
            rowsPerImage: this.height,
          },
          [bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1],
        );
      }
      for (const segment of this.borderSegmentsByProvince[provinceId] ?? []) affectedSegments.add(segment);
    }

    const sortedSegments = [...affectedSegments].sort((a, b) => a - b);
    for (const segment of sortedSegments) this.updateBorderSegment(segment);
    let start = 0;
    while (start < sortedSegments.length) {
      let end = start + 1;
      while (end < sortedSegments.length && sortedSegments[end] === sortedSegments[end - 1] + 1) end += 1;
      const firstSegment = sortedSegments[start];
      const segmentCount = sortedSegments[end - 1] - firstSegment + 1;
      device.queue.writeBuffer(
        borderBuffer,
        firstSegment * 8 * 4,
        this.borderData.buffer as ArrayBuffer,
        this.borderData.byteOffset + firstSegment * 8 * 4,
        segmentCount * 8 * 4,
      );
      start = end;
    }
  }

  private expandBounds(provinceId: number, x: number, y: number): void {
    const bounds = this.bounds[provinceId];
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    } else {
      this.bounds[provinceId] = { minX: x, minY: y, maxX: x, maxY: y };
    }
  }

  private writePixel(index: number, provinceId: number): void {
    const owner = this.provinceOwners[provinceId];
    const target = index * 4;
    if (!owner) {
      this.colors.fill(0, target, target + 4);
      return;
    }
    const source = owner * 4;
    this.colors[target] = Math.round(this.countryColors[source] * 255);
    this.colors[target + 1] = Math.round(this.countryColors[source + 1] * 255);
    this.colors[target + 2] = Math.round(this.countryColors[source + 2] * 255);
    // Country ids fit in one byte. Keeping the owner in alpha lets the terrain
    // shader select a mutable diplomacy color without another province-sized texture.
    this.colors[target + 3] = owner;
  }

  private updateBorderSegment(segment: number): void {
    const offset = segment * 8;
    const provinceA = Math.round(this.borderData[offset + 4]);
    const provinceB = Math.round(this.borderData[offset + 5]);
    const heightAndFlag = Math.abs(this.borderData[offset + 6]);
    this.borderData[offset + 6] = this.provinceOwners[provinceA] !== this.provinceOwners[provinceB]
      ? -heightAndFlag : heightAndFlag;
  }
}
