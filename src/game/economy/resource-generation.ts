import type { PhysicalResource, ProvinceEconomy, ResourcePotential, Stockpile } from '../game-state';
import { emptyStockpile } from '../game-state';
import type { WorldData } from '../world-data';
import { RESOURCE_HUBS } from './resource-hubs';
import { emptyPotential, emptyResourceBuildings, PHYSICAL_RESOURCES, RESOURCE_PRESENCE_CUTOFF } from './resources';

const SPREAD: Record<PhysicalResource, readonly [number, number]> = {
  food: [140, 900], stone: [120, 750], metal: [100, 600], oil: [80, 500],
};
const OPENING_BANDS: Record<keyof Stockpile, readonly [number, number]> = {
  funds: [0.90, 1.10], manpower: [0.90, 1.10], food: [0.85, 1.15],
  stone: [0.90, 1.10], metal: [0.85, 1.15], oil: [0.85, 1.15],
};
const FUNDS_PER_100K = 0.9;
const MANPOWER_PER_100K = 0.5;
const URBAN_FUNDS_BONUS = 4;

export function deterministicResourceNoise(seed: number, provinceId: number, resource: PhysicalResource): number {
  let h = (seed ^ Math.imul(provinceId + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < resource.length; i += 1) h = Math.imul(h ^ resource.charCodeAt(i), 0x85ebca6b) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 0.2 - 0.1;
}

export function wrappedWorldDistance(a: readonly [number, number], b: readonly [number, number], width: number): number {
  let dx = Math.abs(a[0] - b[0]);
  dx = Math.min(dx, width - dx);
  return Math.hypot(dx, a[1] - b[1]);
}

export function resourceHubSpread(resource: PhysicalResource, concentration: number): number {
  const [minSpread, maxSpread] = SPREAD[resource];
  return minSpread + Math.pow(1 - concentration, 1.5) * (maxSpread - minSpread);
}

export function gaussianHubContribution(amount: number, distance: number, spread: number): number {
  return amount * Math.exp(-Math.pow(distance / spread, 2));
}

export function generateResourcePotential(world: WorldData, seed: number): Record<number, ResourcePotential> {
  const centers = new Map(world.provinces.map((province) => [province.id, province.center]));
  const out: Record<number, ResourcePotential> = {};
  for (const province of world.provinces) {
    const potential = emptyPotential();
    for (const resource of PHYSICAL_RESOURCES) {
      let raw = 0;
      for (const hub of RESOURCE_HUBS) {
        if (hub.resource !== resource) continue;
        const center = centers.get(hub.centerProvinceId);
        if (!center) continue;
        const spread = resourceHubSpread(resource, hub.concentration);
        const distance = wrappedWorldDistance(province.center, center, world.width);
        raw += gaussianHubContribution(hub.amount, distance, spread);
      }
      potential[resource] = Math.max(0, Math.min(1,
        raw * (1 + deterministicResourceNoise(seed, province.id, resource)) / 100));
    }
    out[province.id] = potential;
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createProvinceEconomies(
  world: WorldData, seed: number, playableCountryIds: readonly number[],
): Record<number, ProvinceEconomy> {
  const potential = generateResourcePotential(world, seed);
  const playable = new Set(playableCountryIds);
  const out: Record<number, ProvinceEconomy> = {};
  for (const province of world.provinces) {
    const base = emptyStockpile();
    base.funds = (province.population / 100_000) * FUNDS_PER_100K + (province.urban ? URBAN_FUNDS_BONUS : 0);
    base.manpower = (province.population / 100_000) * MANPOWER_PER_100K;
    for (const resource of PHYSICAL_RESOURCES) {
      if (potential[province.id][resource] >= RESOURCE_PRESENCE_CUTOFF[resource]) base[resource] = 1;
    }
    out[province.id] = {
      resourcePotential: potential[province.id], baseProduction: base,
      resourceBuildings: emptyResourceBuildings(), productionCapacity: 1, constructionCapacity: 1,
    };
  }

  // Guarantee one undeveloped source for every resource to each playable country.
  const initialOwners = Object.fromEntries(
    world.provinces.map((province) => [province.id, world.provinceOwner(province.id)]),
  );
  for (const countryId of playable) {
    ensureCountryProvinceResourceBaseline(out, world, initialOwners, countryId);
  }

  // Bake national normalization into the original provinces once.
  const resources = Object.keys(OPENING_BANDS) as Array<keyof Stockpile>;
  for (const resource of resources) {
    const totals = new Map<number, number>();
    for (const countryId of playable) totals.set(countryId, 0);
    for (const province of world.provinces) {
      const owner = world.provinceOwner(province.id);
      if (playable.has(owner)) totals.set(owner, (totals.get(owner) ?? 0) + out[province.id].baseProduction[resource]);
    }
    const benchmark = median([...totals.values()]);
    const [low, high] = OPENING_BANDS[resource];
    for (const [countryId, total] of totals) {
      if (total <= 0 || benchmark <= 0) continue;
      const target = Math.max(benchmark * low, Math.min(benchmark * high, total));
      const factor = target / total;
      if (Math.abs(factor - 1) < 1e-12) continue;
      for (const province of world.provinces) {
        if (world.provinceOwner(province.id) === countryId) out[province.id].baseProduction[resource] *= factor;
      }
    }
  }
  return out;
}

/** Add deterministic undeveloped sources for resources a participating
 * country entirely lacks. Also used when a neutral minor becomes active AI. */
export function ensureCountryProvinceResourceBaseline(
  economies: Record<number, ProvinceEconomy>, world: WorldData,
  provinceOwners: Readonly<Record<number, number>>, countryId: number,
  resources: readonly PhysicalResource[] = PHYSICAL_RESOURCES,
): void {
  const owned = world.provinces.filter((province) => provinceOwners[province.id] === countryId);
  for (const resource of resources) {
    if (owned.some((province) => (economies[province.id]?.baseProduction[resource] ?? 0) > 0)) continue;
    const best = [...owned].sort((a, b) =>
      (economies[b.id]?.resourcePotential[resource] ?? 0)
        - (economies[a.id]?.resourcePotential[resource] ?? 0) || a.id - b.id)[0];
    const economy = best ? economies[best.id] : undefined;
    if (!economy) continue;
    economy.baseProduction[resource] = 1;
    const normalized = economy.normalizedOpeningSites ??= [];
    if (!normalized.includes(resource)) normalized.push(resource);
  }
}
