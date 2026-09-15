import { createIcon, RESOURCE_ICON, type IconName } from './icons';
import { createRankInsignia, catalogueLevel } from './rank-insignia';
import { createUnitPortrait, unitFamilyId, UNIT_ROLE_NOTE } from './unit-portraits';

type CatalogRecord = Record<string, unknown>;
type BuildingId = 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump';

export const BUILDING_ICON: Record<BuildingId, IconName> = {
  barracks: 'structure-barracks', tankPlant: 'structure-plant', ordnance: 'structure-ordnance',
  missileSite: 'structure-missile', fields: 'building-fields', quarry: 'building-quarry',
  mine: 'building-mine', oilPump: 'building-oil-pump',
};

const BUILDING_DESCRIPTION: Record<BuildingId, string> = {
  barracks: 'Trains infantry and engineers. Higher tiers support the matching unit level.',
  tankPlant: 'Produces reconnaissance vehicles and tanks. Higher tiers support more advanced vehicles.',
  ordnance: 'Produces artillery and contributes to strategic ordnance capacity.',
  missileSite: 'Stores strategic warheads and enables long-range strikes.',
  fields: 'Develops local farmland and increases food production.',
  quarry: 'Develops exposed stone deposits and increases stone production.',
  mine: 'Develops mineral deposits and increases metal production.',
  oilPump: 'Develops petroleum deposits and increases oil production.',
};
const BUILDING_UNLOCKS: Partial<Record<BuildingId, readonly [string, string][]>> = {
  barracks: [['infantry', 'Infantry'], ['engineer', 'Engineer']],
  tankPlant: [['armored-car', 'Armored car'], ['light-tank', 'Light tank'], ['medium-tank', 'Medium tank']],
  ordnance: [['artillery', 'Artillery']],
};
const RESOURCE_LABEL: Record<string, string> = {
  funds: 'Funds', food: 'Food', metal: 'Metal', oil: 'Oil', manpower: 'Manpower', stone: 'Stone',
};

function n(record: CatalogRecord, key: string): number { return Number(record[key] ?? 0); }
function object(record: CatalogRecord, key: string): Record<string, number> {
  return (record[key] ?? {}) as Record<string, number>;
}
function section(title: string, ...children: Node[]): HTMLElement {
  const result = document.createElement('section');
  result.className = 'ifg-dossier__section';
  const heading = document.createElement('h3'); heading.textContent = title;
  result.append(heading, ...children); return result;
}
function stat(label: string, value: string): HTMLElement {
  const row = document.createElement('span'); row.className = 'ifg-dossier__stat';
  row.append(Object.assign(document.createElement('small'), { textContent: label }), Object.assign(document.createElement('b'), { textContent: value }));
  return row;
}
function costs(value: Record<string, number>): HTMLElement {
  const row = document.createElement('div'); row.className = 'ifg-dossier__costs';
  for (const [resource, amount] of Object.entries(value)) {
    const icon = RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON];
    if (!icon || amount <= 0) continue;
    const item = document.createElement('span');
    item.setAttribute('aria-label', `${RESOURCE_LABEL[resource] ?? resource} ${amount.toLocaleString()}`);
    item.append(createIcon(icon), Object.assign(document.createElement('b'), { textContent: amount.toLocaleString() })); row.append(item);
  }
  if (!row.childElementCount) row.textContent = 'No resource cost';
  return row;
}

export interface CatalogDossier {
  readonly element: HTMLElement;
  readonly isOpen: () => boolean;
  openUnit(typeId: string): void;
  openBuilding(id: string, level?: number): void;
  close(): void;
}

type CatalogDossierEscapeEvent = Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>;

export function consumeCatalogDossierEscape(
  event: CatalogDossierEscapeEvent,
  close: () => void,
): boolean {
  if (event.key !== 'Escape') return false;
  event.preventDefault();
  event.stopPropagation();
  close();
  return true;
}

export function createCatalogDossier(
  unit: (id: string) => CatalogRecord | undefined,
  building: (id: string) => CatalogRecord | undefined,
): CatalogDossier {
  const overlay = document.createElement('div'); overlay.className = 'ifg-dossier'; overlay.hidden = true;
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  const card = document.createElement('article'); card.className = 'ifg-dossier__card';
  const head = document.createElement('header'); head.className = 'ifg-dossier__head';
  const title = document.createElement('h2');
  const close = document.createElement('button'); close.type = 'button'; close.className = 'ifg-dossier__close'; close.setAttribute('aria-label', 'Close information'); close.append(createIcon('close'));
  head.append(title, close); const body = document.createElement('div'); body.className = 'ifg-dossier__body'; card.append(head, body); overlay.append(card);
  let opener: HTMLElement | null = null;
  const siblingInertState = new Map<HTMLElement, boolean>();
  const shut = (): void => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    for (const [sibling, wasInert] of siblingInertState) sibling.inert = wasInert;
    siblingInertState.clear();
    const returnFocusKey = opener?.dataset.techFocus;
    const returnFocus = opener?.isConnected
      ? opener
      : returnFocusKey
        ? overlay.parentElement?.querySelector<HTMLElement>(`[data-tech-focus="${returnFocusKey}"]`) ?? null
        : null;
    opener = null;
    returnFocus?.focus({ preventScroll: true });
  };
  const reveal = (): void => {
    if (overlay.hidden) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      for (const sibling of Array.from(overlay.parentElement?.children ?? [])) {
        if (!(sibling instanceof HTMLElement) || sibling === overlay) continue;
        siblingInertState.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      overlay.hidden = false;
    }
    queueMicrotask(() => close.focus({ preventScroll: true }));
  };
  close.onclick = shut; overlay.onclick = (event) => { if (event.target === overlay) shut(); };
  overlay.addEventListener('keydown', (event) => {
    if (consumeCatalogDossierEscape(event, shut)) return;
    if (event.key !== 'Tab') return;
    const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
      event.preventDefault();
      close.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const hero = (visual: HTMLElement, name: string, subtitle: string, level: number): HTMLElement => {
    const result = document.createElement('div'); result.className = 'ifg-dossier__hero';
    const art = document.createElement('span'); art.className = 'ifg-dossier__visual'; art.append(visual, createRankInsignia(level, 'ifg-dossier__rank'));
    const copy = document.createElement('span'); copy.append(Object.assign(document.createElement('strong'), { textContent: name }), Object.assign(document.createElement('small'), { textContent: subtitle }));
    result.append(art, copy); return result;
  };
  const openUnit = (typeId: string): void => {
    const data = unit(typeId); if (!data) return;
    const level = catalogueLevel(typeId, n(data, 'level')); const name = String(data.name ?? typeId); const family = String(data.baseId ?? unitFamilyId(typeId));
    title.textContent = 'Unit information'; overlay.setAttribute('aria-label', `${name} information`);
    const attack = object(data, 'attack'); const defense = object(data, 'defense');
    const overview = document.createElement('div'); overview.className = 'ifg-dossier__stats';
    overview.append(stat('Hitpoints', String(n(data, 'maxHp'))), stat('Speed', String(n(data, 'speed'))), stat('View range', `${n(data, 'visionInner')} / ${n(data, 'visionOuter')}`), stat('Attack range', String(n(data, 'engagementRange'))), stat('Production work', `${n(data, 'buildWork')} h`), stat('Armor', String(data.armorClass ?? 'soft')));
    const combat = document.createElement('table'); combat.className = 'ifg-dossier__combat';
    combat.innerHTML = '<thead><tr><th>Target</th><th>Attack</th><th>Defence</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const [key, label] of [['soft', 'Unarmored'], ['light', 'Light armor'], ['heavy', 'Heavy armor']] as const) {
      const tr = document.createElement('tr'); tr.innerHTML = `<th>${label}</th><td>${Number(attack[key] ?? 0).toFixed(1)}</td><td>${Number(defense[key] ?? 0).toFixed(1)}</td>`; tbody.append(tr);
    }
    combat.append(tbody);
    const upkeep = costs(object(data, 'upkeep')); upkeep.prepend(Object.assign(document.createElement('small'), { textContent: 'Hourly upkeep' }));
    body.replaceChildren(hero(createUnitPortrait(typeId, name), name, `${String(data.category ?? 'Unit')} · Level ${level}`, level),
      section('Unit overview', overview), section('Description', Object.assign(document.createElement('p'), { textContent: UNIT_ROLE_NOTE[family] ?? 'A field unit in the national order of battle.' })),
      section('Combat statistics', combat), section('Production cost', costs(object(data, 'buildCost')), upkeep));
    reveal();
  };
  const openBuilding = (rawId: string, explicitLevel?: number): void => {
    const id = rawId as BuildingId; const data = building(id); if (!data) return;
    const level = catalogueLevel(id, explicitLevel); const name = String(data.label ?? id);
    const tiers = (data.tiers ?? []) as Array<{ cost?: Record<string, number>; work?: number }>; const tier = tiers[level - 1] ?? tiers[0] ?? {};
    title.textContent = 'Building information'; overlay.setAttribute('aria-label', `${name} information`);
    const overview = document.createElement('div'); overview.className = 'ifg-dossier__stats';
    overview.append(stat('Type', String(data.kind ?? 'structure')), stat('Level', String(level)), stat('Construction work', `${Number(tier.work ?? data.buildWork ?? 0)} h`), stat('Status', 'Functional when complete'));
    const unlockGrid = document.createElement('div'); unlockGrid.className = 'ifg-dossier__unlocks';
    for (const [family, label] of BUILDING_UNLOCKS[id] ?? []) {
      const typeId = level === 1 ? family : `${family}-l${level}`; const tile = document.createElement('button'); tile.type = 'button';
      tile.append(createUnitPortrait(typeId, label), Object.assign(document.createElement('b'), { textContent: label }));
      tile.onclick = () => openUnit(typeId); unlockGrid.append(tile);
    }
    if (!unlockGrid.childElementCount) unlockGrid.append(Object.assign(document.createElement('p'), { textContent: data.kind === 'resource' ? `Increases ${name.toLowerCase()} output at this tier.` : 'Provides its strategic capability when complete.' }));
    body.replaceChildren(hero(createIcon(BUILDING_ICON[id] ?? 'industry'), name, `Structure · Level ${level}`, level),
      section('Description', Object.assign(document.createElement('p'), { textContent: BUILDING_DESCRIPTION[id] ?? 'A strategic provincial structure.' })),
      section('Attributes', overview), section('Unlocks', unlockGrid), section('Construction cost', costs(tier.cost ?? object(data, 'cost'))));
    reveal();
  };
  return { element: overlay, isOpen: () => !overlay.hidden, openUnit, openBuilding, close: shut };
}
