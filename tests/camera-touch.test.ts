import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrategyCamera } from '../src/camera';

class TestCanvas extends EventTarget {
  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 400, height: 300 } as DOMRect;
  }

  setPointerCapture(): void {}
}

function pointerEvent(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
  pointerType = 'touch',
): PointerEvent {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  });
  return event as PointerEvent;
}

function createHarness(): { camera: StrategyCamera; canvas: TestCanvas; viewport: EventTarget } {
  const viewport = new EventTarget();
  vi.stubGlobal('window', viewport);
  const canvas = new TestCanvas();
  const camera = new StrategyCamera();
  camera.configureWorld(2_000, 1_000);
  camera.resize(400, 300);
  camera.attach(canvas as unknown as HTMLCanvasElement);
  return { camera, canvas, viewport };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('touch camera controls', () => {
  it('pans the map with one finger', () => {
    const { camera, canvas, viewport } = createHarness();
    const startX = camera.target[0];

    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 120, 140));
    viewport.dispatchEvent(pointerEvent('pointermove', 1, 170, 140));
    viewport.dispatchEvent(pointerEvent('pointerup', 1, 170, 140));

    expect(camera.target[0]).toBeLessThan(startX);
    camera.detach();
  });

  it('zooms around a two-finger pinch while allowing the pinch center to move', () => {
    const { camera, canvas, viewport } = createHarness();
    const startDistance = camera.distance;
    const startX = camera.target[0];

    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 100, 140));
    canvas.dispatchEvent(pointerEvent('pointerdown', 2, 200, 140));
    viewport.dispatchEvent(pointerEvent('pointermove', 2, 250, 140));

    expect(camera.distance).toBeLessThan(startDistance);
    expect(camera.target[0]).not.toBe(startX);
    camera.detach();
  });
});

describe('mouse camera controls', () => {
  it('updates camera matrices during a left-button pan, before pointer-up', () => {
    const { camera, canvas, viewport } = createHarness();
    const revision = camera.revision;

    canvas.dispatchEvent(pointerEvent('pointerdown', 7, 120, 140, 'mouse'));
    viewport.dispatchEvent(pointerEvent('pointermove', 7, 170, 140, 'mouse'));

    expect(camera.revision).toBeGreaterThan(revision);
    viewport.dispatchEvent(pointerEvent('pointerup', 7, 170, 140, 'mouse'));
    camera.detach();
  });
});
