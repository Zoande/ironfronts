import type { BinaryField } from './types';

export function sampleWrappedField(
  data: Float32Array | Uint16Array,
  field: BinaryField,
  worldWidth: number,
  worldHeight: number,
  worldX: number,
  worldZ: number,
): number {
  const x = wrap(Math.floor(worldX / worldWidth * field.width), field.width);
  const y = clamp(Math.floor(worldZ / worldHeight * field.height), 0, field.height - 1);
  return data[y * field.width + x] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}
