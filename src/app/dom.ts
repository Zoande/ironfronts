import type { MapMode } from '../renderer';

export function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

export function isMapMode(value: string): value is MapMode {
  return value === 'political' || value === 'diplomacy' || value === 'clear' || value === 'balanced';
}
