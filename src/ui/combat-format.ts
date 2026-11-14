/** Compact per-hour rates keep late-campaign armies inside narrow stat cells. */
export function formatDamageRate(value: number): string {
  if (!Number.isFinite(value)) return '--';
  if (value <= 0) return '0';
  for (const [scale,suffix] of [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']] as const) {
    if (value < scale * .9995) continue;
    const scaled = value / scale;
    return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${suffix}`;
  }
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}
