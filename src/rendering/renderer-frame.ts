export interface WorldFrame {
  encoder: GPUCommandEncoder;
  pass: GPURenderPassEncoder;
}

export function beginWorldFrame(
  device: GPUDevice,
  context: GPUCanvasContext,
  depthTexture: GPUTexture,
  clearColor: [number, number, number],
  timestampQuerySet?: GPUQuerySet,
): WorldFrame {
  const encoder = device.createCommandEncoder({ label: 'world frame' });
  const passDescriptor: GPURenderPassDescriptor = {
    label: 'world render pass',
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  };
  if (timestampQuerySet) {
    passDescriptor.timestampWrites = {
      querySet: timestampQuerySet,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
  }
  return { encoder, pass: encoder.beginRenderPass(passDescriptor) };
}

export function submitWorldFrame(
  device: GPUDevice,
  frame: WorldFrame,
  timestampQuerySet?: GPUQuerySet,
  resolveBuffer?: GPUBuffer,
  readBuffer?: GPUBuffer,
): void {
  frame.pass.end();
  if (timestampQuerySet && resolveBuffer && readBuffer) {
    frame.encoder.resolveQuerySet(timestampQuerySet, 0, 2, resolveBuffer, 0);
    frame.encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
  }
  device.queue.submit([frame.encoder.finish()]);
}
