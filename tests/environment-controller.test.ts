import { describe, expect, it } from 'vitest';
import { EnvironmentController } from '../src/rendering/environment-controller';

describe('EnvironmentController', () => {
  it('preserves the existing time controls and multiplier limits', () => {
    const environment = new EnvironmentController();
    environment.setTimeOfDay(23.5);
    expect(environment.getTimeOfDay().clock).toBe('23:30');
    expect(environment.setTimeMultiplier(2_000)).toBe(999.9);
    expect(environment.setTimeMultiplier(-2)).toBe(0);
  });

  it('advances time independently from the weather transition delta', () => {
    const environment = new EnvironmentController();
    environment.setTimeOfDay(8);
    environment.setTimeMultiplier(1);
    environment.update(25, 0);
    expect(environment.getTimeOfDay().hour).toBeCloseTo(9);
    expect(environment.rainIntensity).toBe(0);
  });

  it('fades rain in and out over the existing 1.5 second transition', () => {
    const environment = new EnvironmentController();
    environment.setRainEnabled(true);
    environment.update(0, 0.75);
    expect(environment.rainIntensity).toBeCloseTo(0.5);
    environment.update(0, 0.75);
    expect(environment.rainIntensity).toBe(1);
    environment.setRainEnabled(false);
    environment.update(0, 1.5);
    expect(environment.rainIntensity).toBe(0);
  });
});
