import { MAX_SIMULATION_STEP_SECONDS } from '@ironfronts/game-core';

/** Retains elapsed simulation debt while limiting each callback's work.
 * At 1x it dispatches the live wall-clock delta. Extreme fast-forward is
 * chunked into bounded game-time slices instead of millions of 100ms steps. */
export class SimulationScheduler {
  private previousMs: number;
  private debtSeconds = 0;
  constructor(
    private readonly step: (hours: number) => void,
    private readonly now: () => number = () => performance.now(),
    // One bounded integration slice per timer turn keeps the HTTP/WebSocket
    // event loop responsive under extreme fast-forward. Any remainder stays
    // as debt and is processed by later turns instead of monopolising Node.
    private readonly maxStepsPerPump = 1,
  ) { this.previousMs = now(); }

  pump(speed: number): number {
    const now = this.now();
    this.debtSeconds += Math.max(0, now - this.previousMs) / 1_000 * speed;
    this.previousMs = now;
    let steps = 0;
    while (this.debtSeconds > 1e-9 && steps < this.maxStepsPerPump) {
      const seconds = Math.min(this.debtSeconds, MAX_SIMULATION_STEP_SECONDS);
      this.step(seconds / 3_600);
      this.debtSeconds = Math.max(0, this.debtSeconds - seconds);
      steps++;
    }
    return steps;
  }

  get pendingSeconds(): number { return this.debtSeconds; }
}
