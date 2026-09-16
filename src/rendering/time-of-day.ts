export const HOURS_PER_DAY = 24;
export const DEFAULT_DAY_DURATION_SECONDS = 600;
export const DEFAULT_START_HOUR = 8;
export const MIN_TIME_MULTIPLIER = 0;
export const MAX_TIME_MULTIPLIER = 999.9;

export type DayStage = 'Night' | 'Dawn' | 'Morning' | 'Day' | 'Sunset' | 'Evening';

export interface TimeOfDayLighting {
  hour: number;
  stage: DayStage;
  sunDirection: [number, number, number];
  daylight: number;
  twilight: number;
  night: number;
  skyColor: [number, number, number];
}

export function wrapHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_START_HOUR;
  return ((hour % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

export function clampTimeMultiplier(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return 1;
  return Math.min(MAX_TIME_MULTIPLIER, Math.max(MIN_TIME_MULTIPLIER, multiplier));
}

export function advanceHour(
  hour: number,
  deltaSeconds: number,
  multiplier: number,
  dayDurationSeconds = DEFAULT_DAY_DURATION_SECONDS,
): number {
  if (deltaSeconds <= 0 || dayDurationSeconds <= 0) return wrapHour(hour);
  return wrapHour(hour + deltaSeconds * clampTimeMultiplier(multiplier) * HOURS_PER_DAY / dayDurationSeconds);
}

export function calculateTimeOfDay(hourInput: number): TimeOfDayLighting {
  const hour = wrapHour(hourInput);
  const solarAngle = (hour - 6) / HOURS_PER_DAY * Math.PI * 2;
  const sunElevation = Math.sin(solarAngle);
  const horizontal = Math.cos(solarAngle);
  const rawSun: [number, number, number] = [horizontal * 0.82, sunElevation, 0.42];
  const length = Math.hypot(...rawSun);
  const sunDirection = rawSun.map((value) => value / length) as [number, number, number];
  const daylight = smoothstep(-0.12, 0.22, sunElevation);
  const night = 1 - smoothstep(-0.24, 0.06, sunElevation);
  const twilight = (1 - smoothstep(0.04, 0.46, Math.abs(sunElevation))) * (1 - night * 0.35);

  const nightSky: [number, number, number] = [0.035, 0.055, 0.115];
  const daySky: [number, number, number] = [0.45, 0.57, 0.61];
  const twilightSky: [number, number, number] = [0.62, 0.36, 0.25];
  const baseSky = mixColor(nightSky, daySky, daylight);
  const skyColor = mixColor(baseSky, twilightSky, twilight * 0.46);

  return { hour, stage: stageForHour(hour), sunDirection, daylight, twilight, night, skyColor };
}

export function stageForHour(hourInput: number): DayStage {
  const hour = wrapHour(hourInput);
  if (hour < 5 || hour >= 22) return 'Night';
  if (hour < 7) return 'Dawn';
  if (hour < 11) return 'Morning';
  if (hour < 17) return 'Day';
  if (hour < 19.5) return 'Sunset';
  return 'Evening';
}

export function formatClock(hourInput: number): string {
  const totalMinutes = Math.floor(wrapHour(hourInput) * 60 + 0.5) % (HOURS_PER_DAY * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseClock(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour >= HOURS_PER_DAY || minute < 0 || minute >= 60) return undefined;
  return hour + minute / 60;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  amount: number,
): [number, number, number] {
  return a.map((value, index) => value + (b[index] - value) * amount) as [number, number, number];
}
