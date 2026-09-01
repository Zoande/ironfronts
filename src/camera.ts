import { mat4, vec3, vec4 } from 'gl-matrix';

const UP = vec3.fromValues(0, 1, 0);

export class StrategyCamera {
  readonly view = mat4.create();
  readonly projection = mat4.create();
  readonly viewProjection = mat4.create();
  readonly inverseViewProjection = mat4.create();
  readonly position = vec3.create();
  readonly target = vec3.create();

  distance = 8_900;
  yaw = 0;
  pitch = 0.78;
  minDistance = 180;
  maxDistance = 10_800;
  minimumAltitude = 300;
  worldWidth = 13_562;
  worldHeight = 7_000;
  viewportWidth = 1;
  viewportHeight = 1;
  revision = 0;

  private keys = new Set<string>();
  private dragMode: 'pan' | 'orbit' | null = null;
  private lastPointer = [0, 0];
  private readonly activeTouches = new Map<number, { x: number; y: number }>();
  private pinchCenter = [0, 0];
  private pinchDistance = 0;
  private canvas?: HTMLCanvasElement;
  private canvasRect = { left: 0, top: 0, width: 1, height: 1 };
  private readonly move = vec3.create();
  private readonly rayNear = vec4.create();
  private readonly rayFar = vec4.create();
  private readonly rayOrigin = vec3.create();
  private readonly rayDirection = vec3.create();
  private readonly ray = { origin: this.rayOrigin, direction: this.rayDirection };
  private readonly groundPointScratch = vec3.create();
  private matrixState = [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN];

  constructor() {
    vec3.set(this.target, this.worldWidth * 0.5, 0, this.worldHeight * 0.5);
  }

  configureWorld(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    vec3.set(this.target, width * 0.5, 0, height * 0.5);
    this.maxDistance = Math.max(width, height) * 0.8;
    this.distance = Math.max(width, height) * 0.66;
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return;
    if (this.canvas) this.detach();
    this.canvas = canvas;
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.refreshCanvasRect);
    window.addEventListener('scroll', this.refreshCanvasRect, true);
    this.refreshCanvasRect();
  }

  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.refreshCanvasRect);
    window.removeEventListener('scroll', this.refreshCanvasRect, true);
    this.keys.clear();
    this.activeTouches.clear();
    this.pinchDistance = 0;
    this.dragMode = null;
    this.canvas = undefined;
  }

  resize(width: number, height: number): void {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    if (nextWidth === this.viewportWidth && nextHeight === this.viewportHeight) return;
    this.viewportWidth = nextWidth;
    this.viewportHeight = nextHeight;
    this.refreshCanvasRect();
    this.recalculateMatrices();
  }

  update(deltaSeconds: number): void {
    vec3.set(this.move, 0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move[2] -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move[2] += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move[0] -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move[0] += 1;
    if (vec3.squaredLength(this.move) > 0) {
      vec3.normalize(this.move, this.move);
      const speed = clamp(this.distance * 0.48, 140, 2_900) * deltaSeconds;
      this.pan(this.move[0] * speed, this.move[2] * speed);
    }
    this.normalizeTarget();
    this.recalculateMatrices();
  }

  screenRay(clientX: number, clientY: number): { origin: vec3; direction: vec3 } {
    const rect = this.canvasRect;
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((clientY - rect.top) / rect.height) * 2;
    vec4.set(this.rayNear, x, y, 0, 1);
    vec4.set(this.rayFar, x, y, 1, 1);
    vec4.transformMat4(this.rayNear, this.rayNear, this.inverseViewProjection);
    vec4.transformMat4(this.rayFar, this.rayFar, this.inverseViewProjection);
    vec4.scale(this.rayNear, this.rayNear, 1 / this.rayNear[3]);
    vec4.scale(this.rayFar, this.rayFar, 1 / this.rayFar[3]);
    vec3.set(this.rayOrigin, this.rayNear[0], this.rayNear[1], this.rayNear[2]);
    vec3.set(
      this.rayDirection,
      this.rayFar[0] - this.rayNear[0],
      this.rayFar[1] - this.rayNear[1],
      this.rayFar[2] - this.rayNear[2],
    );
    vec3.normalize(this.rayDirection, this.rayDirection);
    return this.ray;
  }

  private recalculateMatrices(): void {
    this.distance = Math.max(this.distance, this.minimumAltitude / Math.max(0.12, Math.sin(this.pitch)));
    const nextState = [
      this.target[0], this.target[2], this.distance, this.yaw, this.pitch, this.viewportWidth, this.viewportHeight,
    ];
    if (nextState.every((value, index) => Math.abs(value - this.matrixState[index]) < 0.00001)) return;
    this.matrixState = nextState;
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.position[0] = this.target[0] + Math.sin(this.yaw) * horizontal;
    this.position[1] = Math.sin(this.pitch) * this.distance;
    this.position[2] = this.target[2] + Math.cos(this.yaw) * horizontal;
    mat4.perspectiveZO(this.projection, Math.PI / 4.1, this.viewportWidth / this.viewportHeight, 2, 40_000);
    mat4.lookAt(this.view, this.position, this.target, UP);
    mat4.multiply(this.viewProjection, this.projection, this.view);
    mat4.invert(this.inverseViewProjection, this.viewProjection);
    this.revision += 1;
  }

  private refreshCanvasRect = (): void => {
    const rect = this.canvas?.getBoundingClientRect();
    this.canvasRect = rect
      ? { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
      : { left: 0, top: 0, width: this.viewportWidth, height: this.viewportHeight };
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private pan(rightAmount: number, forwardAmount: number): void {
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    this.target[0] += rightX * rightAmount + forwardX * forwardAmount;
    this.target[2] += rightZ * rightAmount + forwardZ * forwardAmount;
  }

  private normalizeTarget(): void {
    this.target[0] = ((this.target[0] % this.worldWidth) + this.worldWidth) % this.worldWidth;
    this.target[2] = clamp(this.target[2], -160, this.worldHeight + 160);
  }

  private onPointerDown = (event: PointerEvent): void => {
    // 0 = left (pan), 1 = middle (orbit). Right (2) is left for the game's
    // order system; touch is handled separately below.
    if (event.pointerType !== 'touch' && event.button !== 0 && event.button !== 1) return;
    if (event.pointerType === 'touch') {
      event.preventDefault();
      this.activeTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.canvas?.setPointerCapture?.(event.pointerId);
      if (this.activeTouches.size === 1) {
        this.dragMode = 'pan';
        this.lastPointer = [event.clientX, event.clientY];
      } else {
        this.dragMode = null;
        this.startPinch();
      }
      return;
    }
    // Left = pan, middle = orbit. Right-click is reserved for issuing army
    // orders (see main.ts) and must never move the camera.
    event.preventDefault();
    this.dragMode = event.button === 1 ? 'orbit' : 'pan';
    this.lastPointer = [event.clientX, event.clientY];
    this.canvas?.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      const touch = this.activeTouches.get(event.pointerId);
      if (!touch) return;
      event.preventDefault();
      touch.x = event.clientX;
      touch.y = event.clientY;

      if (this.activeTouches.size >= 2) {
        const [first, second] = [...this.activeTouches.values()];
        const centerX = (first.x + second.x) * 0.5;
        const centerY = (first.y + second.y) * 0.5;
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const dx = centerX - this.pinchCenter[0];
        const dy = centerY - this.pinchCenter[1];
        if (this.pinchDistance > 0) this.zoomAt(centerX, centerY, this.pinchDistance / distance);
        const panScale = this.distance * 0.00145;
        // Grab-and-drag: the point under the cursor should follow it on both
        // axes. `pan`'s forward axis points up-screen, so dragging down must
        // pan forward (+dy), not backward.
        this.pan(-dx * panScale, dy * panScale);
        this.pinchCenter = [centerX, centerY];
        this.pinchDistance = distance;
        return;
      }

      const dx = event.clientX - this.lastPointer[0];
      const dy = event.clientY - this.lastPointer[1];
      this.lastPointer = [event.clientX, event.clientY];
      const scale = this.distance * 0.00145;
      this.pan(-dx * scale, dy * scale);
      return;
    }
    if (!this.dragMode) return;
    const dx = event.clientX - this.lastPointer[0];
    const dy = event.clientY - this.lastPointer[1];
    this.lastPointer = [event.clientX, event.clientY];
    if (this.dragMode === 'orbit') {
      this.yaw -= dx * 0.0045;
      // Upper bound raised so the player can orbit up to the near-top-down
      // strategic start view (~1.45 rad ≈ 83°); a true 90° degenerates picking.
      this.pitch = clamp(this.pitch + dy * 0.0035, 0.43, 1.45);
    } else {
      const scale = this.distance * 0.00145;
      // Grab-and-drag: dragging down pulls the map down, so pan forward (+dy).
      this.pan(-dx * scale, dy * scale);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.activeTouches.delete(event.pointerId);
      if (this.activeTouches.size === 1) {
        const remaining = this.activeTouches.values().next().value as { x: number; y: number };
        this.dragMode = 'pan';
        this.lastPointer = [remaining.x, remaining.y];
      } else {
        this.dragMode = null;
      }
      this.pinchDistance = 0;
      return;
    }
    this.dragMode = null;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomAt(event.clientX, event.clientY, Math.exp(event.deltaY * 0.00115));
  };

  private startPinch(): void {
    const [first, second] = [...this.activeTouches.values()];
    if (!first || !second) return;
    this.pinchCenter = [(first.x + second.x) * 0.5, (first.y + second.y) * 0.5];
    this.pinchDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const before = this.groundPoint(clientX, clientY);
    const beforeX = before?.[0];
    const beforeZ = before?.[2];
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
    this.recalculateMatrices();
    const after = this.groundPoint(clientX, clientY);
    if (beforeX !== undefined && beforeZ !== undefined && after) {
      this.target[0] += beforeX - after[0];
      this.target[2] += beforeZ - after[2];
      this.normalizeTarget();
      this.recalculateMatrices();
    }
  }

  private groundPoint(clientX: number, clientY: number): vec3 | null {
    const ray = this.screenRay(clientX, clientY);
    if (Math.abs(ray.direction[1]) < 0.0001) return null;
    const distance = -ray.origin[1] / ray.direction[1];
    if (distance < 0) return null;
    vec3.scaleAndAdd(this.groundPointScratch, ray.origin, ray.direction, distance);
    return this.groundPointScratch;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
