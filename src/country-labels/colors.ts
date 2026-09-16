import type { CountryRecord } from '../rendering/types';

export function buildCountryColorBuffer(countries: CountryRecord[]): Float32Array {
  const maximumId = Math.max(0, ...countries.map((country) => country.id));
  const colors = new Float32Array((maximumId + 1) * 4);
  for (const country of countries) {
    const [red, green, blue] = parseHexColor(country.color);
    const offset = country.id * 4;
    colors[offset] = red;
    colors[offset + 1] = green;
    colors[offset + 2] = blue;
    colors[offset + 3] = 1;
  }
  return colors;
}

function parseHexColor(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return [0.45, 0.52, 0.48];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
