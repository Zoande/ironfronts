import {
  advanceHour, calculateTimeOfDay, clampTimeMultiplier, DEFAULT_START_HOUR, formatClock, wrapHour,
  type TimeOfDayLighting,
} from './time-of-day';

const RAIN_TRANSITION_SECONDS = 1.5;

export interface TimeOfDayState extends TimeOfDayLighting {
  clock: string;
  multiplier: number;
}

export class EnvironmentController {
  private hour = DEFAULT_START_HOUR;
  private multiplier = 1;
  private currentLighting = calculateTimeOfDay(DEFAULT_START_HOUR);
  private rainEnabled = false;
  private currentRainIntensity = 0;
  private currentSkyColor: [number, number, number] = [...this.currentLighting.skyColor];

  get lighting(): TimeOfDayLighting {
    return this.currentLighting;
  }

  get skyColor(): [number, number, number] {
    return this.currentSkyColor;
  }

  get rainIntensity(): number {
    return this.currentRainIntensity;
  }

  get dayPhase(): number {
    return this.hour / 24;
  }

  update(timeDeltaSeconds: number, weatherDeltaSeconds: number): void {
    this.hour = advanceHour(this.hour, timeDeltaSeconds, this.multiplier);
    this.currentLighting = calculateTimeOfDay(this.hour);
    const target = this.rainEnabled ? 1 : 0;
    const step = Math.min(1, Math.max(0, weatherDeltaSeconds) / RAIN_TRANSITION_SECONDS);
    if (this.currentRainIntensity < target) {
      this.currentRainIntensity = Math.min(target, this.currentRainIntensity + step);
    } else if (this.currentRainIntensity > target) {
      this.currentRainIntensity = Math.max(target, this.currentRainIntensity - step);
    }

    const nightOvercast: [number, number, number] = [0.045, 0.062, 0.10];
    const dayOvercast: [number, number, number] = [0.29, 0.35, 0.38];
    const overcast = mixRgb(nightOvercast, dayOvercast, this.currentLighting.daylight);
    this.currentSkyColor = mixRgb(this.currentLighting.skyColor, overcast, this.currentRainIntensity * 0.78);
  }

  setTimeOfDay(hour: number): void {
    this.hour = wrapHour(hour);
    this.currentLighting = calculateTimeOfDay(this.hour);
    this.refreshSkyColor();
  }

  setTimeMultiplier(multiplier: number): number {
    this.multiplier = clampTimeMultiplier(multiplier);
    return this.multiplier;
  }

  setRainEnabled(enabled: boolean): void {
    this.rainEnabled = enabled;
  }

  isRainEnabled(): boolean {
    return this.rainEnabled;
  }

  getTimeOfDay(): TimeOfDayState {
    return {
      ...this.currentLighting,
      clock: formatClock(this.hour),
      multiplier: this.multiplier,
    };
  }

  private refreshSkyColor(): void {
    const nightOvercast: [number, number, number] = [0.045, 0.062, 0.10];
    const dayOvercast: [number, number, number] = [0.29, 0.35, 0.38];
    const overcast = mixRgb(nightOvercast, dayOvercast, this.currentLighting.daylight);
    this.currentSkyColor = mixRgb(this.currentLighting.skyColor, overcast, this.currentRainIntensity * 0.78);
  }
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  amount: number,
): [number, number, number] {
  return a.map((value, index) => value + (b[index] - value) * amount) as [number, number, number];
}
