import type { InstanceLayer, VisibleInstanceView } from './renderer-types';

export interface VisibleInstances {
  instances: Uint32Array;
  draws: VisibleInstanceView['draws'];
  visibleChunks: number;
}

export function getVisibleInstanceView(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  layer: InstanceLayer,
  key: string,
  label: string,
): VisibleInstanceView {
  if (!layer.views) throw new Error(`Missing visible-instance storage for ${label}`);
  const existing = layer.views.get(key);
  if (existing) return existing;

  const buffer = device.createBuffer({
    label: `${label} visible instances`,
    size: Math.max(4, layer.count * 3 * Uint32Array.BYTES_PER_ELEMENT),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const view: VisibleInstanceView = {
    buffer,
    bindGroup: device.createBindGroup({
      label: `${label} visible bind group`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: layer.buffer } },
        { binding: 1, resource: { buffer: layer.params } },
        { binding: 2, resource: { buffer } },
      ],
    }),
    revision: -1,
    draws: [],
    visibleChunks: 0,
  };
  layer.views.set(key, view);
  return view;
}

export function updateVisibleInstanceView(
  queue: GPUQueue,
  view: VisibleInstanceView,
  revision: number,
  visibility: VisibleInstances,
): void {
  view.visibleChunks = visibility.visibleChunks;
  view.draws = visibility.draws;
  if (visibility.instances.length) {
    queue.writeBuffer(
      view.buffer,
      0,
      visibility.instances.buffer as ArrayBuffer,
      visibility.instances.byteOffset,
      visibility.instances.byteLength,
    );
  }
  view.revision = revision;
}
