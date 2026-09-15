const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(value: number): string {
  return compactNumber.format(value);
}

export function formatBytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}
