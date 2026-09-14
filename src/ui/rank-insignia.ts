/** Level-aware insignia used wherever a catalogue item is presented. */
export function catalogueLevel(typeId: string, explicit?: number): number {
  if (explicit !== undefined) return Math.max(1, Math.min(8, Math.round(explicit)));
  const match = /-l([2-8])$/.exec(typeId);
  return match ? Number(match[1]) : 1;
}

export function createRankInsignia(level: number, className = ''): HTMLElement {
  const safe = Math.max(1, Math.min(8, Math.round(level)));
  const badge = document.createElement('span');
  badge.className = `ifg-rank${className ? ` ${className}` : ''}`;
  badge.dataset.level = String(safe);
  badge.setAttribute('aria-label', `Level ${safe}`);
  badge.title = `Level ${safe}`;
  const chevrons = safe <= 4 ? safe : safe - 4;
  for (let index = 0; index < chevrons; index += 1) badge.append(document.createElement('i'));
  if (safe > 4) badge.append(Object.assign(document.createElement('b'), { textContent: '◆' }));
  return badge;
}
