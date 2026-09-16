import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { HOURS_PER_WARHEAD, stepWarheads } from '../../src/game/strike';
import { emptyStockpile, relationOf, setRelation } from '../../src/game/game-state';
import { BUILDINGS, queueBuilding } from '../../src/game/construction';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import { loadWorld, type LoadedWorld } from './load-world';
import { PROTOTYPE_HOURS_PER_HOUR } from '../../src/game/time';

const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

function session(): GameSession {
  return GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
}

function foreignProvince(s: GameSession) {
  const p = world.provinces.find((province) => {
    const owner = s.state.provinceOwners[province.id];
    return owner && owner !== SPAIN;
  });
  if (!p) throw new Error('no foreign province in scenario');
  return { province: p, ownerId: s.state.provinceOwners[p.id] };
}

function ownUrbanProvince(s: GameSession) {
  const p = world.provinces.find(
    (province) => s.state.provinceOwners[province.id] === SPAIN && province.urban,
  );
  if (!p) throw new Error('no Spanish urban province in scenario');
  return p;
}

/**
 * A strike now needs a friendly Missile Site within range of the aim point.
 * Pick the closest Spain / foreign province pair and stamp a site on the Spain
 * side so the target is reachable.
 */
function strikeableForeignProvince(s: GameSession) {
  const own = world.provinces.filter((p) => s.state.provinceOwners[p.id] === SPAIN);
  let best: { province: typeof world.provinces[number]; site: typeof own[number]; d: number } | null = null;
  for (const province of world.provinces) {
    const owner = s.state.provinceOwners[province.id];
    if (!owner || owner === SPAIN) continue;
    for (const site of own) {
      const d = Math.hypot(site.center[0] - province.center[0], site.center[1] - province.center[1]);
      if (!best || d < best.d) best = { province, site, d };
    }
  }
  if (!best) throw new Error('no foreign province in scenario');
  s.state.provinceBuildings[best.site.id] = { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 1 };
  return {
    province: best.province,
    ownerId: s.state.provinceOwners[best.province.id],
    siteProvinceId: best.site.id,
  };
}

describe('strategic strike', () => {
  it('enforces the late-game strategic-infrastructure investment', () => {
    expect(BUILDINGS.ordnance).toEqual({
      label: 'Ordnance Workshop', cost: { funds: 1_600, stone: 480, metal: 640 },
      buildTimeHours: 480 / (4 * PROTOTYPE_HOURS_PER_HOUR),
    });
    expect(BUILDINGS.missileSite).toEqual({
      label: 'Missile Site', cost: { funds: 2_400, stone: 720, metal: 960 },
      buildTimeHours: 720 / (4 * PROTOTYPE_HOURS_PER_HOUR),
    });

    for (const buildingId of ['ordnance', 'missileSite'] as const) {
      const s = session();
      const province = ownUrbanProvince(s);
      const cost = { ...emptyStockpile(), ...BUILDINGS[buildingId].cost };
      s.state.provinceBuildings[province.id] = {
        barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 0,
      };
      s.state.countries[SPAIN].stockpile = { ...cost, metal: cost.metal - 1 };

      expect(queueBuilding(s, province.id, buildingId, SPAIN)).toMatchObject({ ok: false });
      expect(s.state.constructionQueues[province.id]).toBeUndefined();

      s.state.countries[SPAIN].stockpile = cost;
      expect(queueBuilding(s, province.id, buildingId, SPAIN)).toMatchObject({ ok: true });
      expect(s.state.constructionQueues[province.id][0].totalHours)
        .toBe(BUILDINGS[buildingId].buildTimeHours);
    }
  });

  it('spends a warhead, wipes stacks, levels buildings and forces war', () => {
    const s = session();
    const { province, ownerId } = strikeableForeignProvince(s);
    const [x, z] = province.center;

    s.state.countries[SPAIN].warheads = 1;
    s.state.provinceBuildings[province.id] = { barracks: 2, tankPlant: 1, ordnance: 0, missileSite: 1 };
    s.state.armies['victim'] = {
      id: 'victim', ownerCountryId: ownerId, name: 'Garrison', x, z,
      graphNodeId: 0, units: [{ typeId: 'infantry', count: 3, hp: 240, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    } as never;

    const res = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });

    expect(res.ok).toBe(true);
    expect(res.strike).toMatchObject({ attacker: SPAIN, defender: ownerId, provinceId: province.id });
    expect(s.state.countries[SPAIN].warheads).toBe(0);
    expect(s.state.armies.victim).toBeUndefined();
    expect(s.state.provinceBuildings[province.id])
      .toMatchObject({ barracks: 1, tankPlant: 0, ordnance: 0, missileSite: 0 });
    expect(relationOf(s.state, SPAIN, ownerId)).toBe('war');

    const event = s.pendingCombat.find((e) => e.kind === 'strike');
    expect(event).toMatchObject({ attacker: SPAIN, defender: ownerId, provinceId: province.id, x, z });
  });

  it('rejects cleanly when the country has no warhead field (pre-strike save)', () => {
    const s = session();
    const { province } = foreignProvince(s);
    const [x, z] = province.center;
    delete (s.state.countries[SPAIN] as { warheads?: number }).warheads;

    const res = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });

    expect(res.ok).toBe(false);
    expect(res.strike).toBeUndefined();
    expect(s.pendingCombat.some((e) => e.kind === 'strike')).toBe(false);
  });

  it('rejects a strike on your own territory', () => {
    const s = session();
    const own = world.provinces.find((p) => s.state.provinceOwners[p.id] === SPAIN)!;
    s.state.countries[SPAIN].warheads = 1;
    const res = s.applyCommand({
      type: 'strike', countryId: SPAIN, provinceId: own.id, x: own.center[0], z: own.center[1],
    });
    expect(res.ok).toBe(false);
    expect(s.state.countries[SPAIN].warheads).toBe(1);
  });

  it('rejects a strike on allied territory without spending a warhead', () => {
    const s = session();
    const { province, ownerId } = strikeableForeignProvince(s);
    const [x, z] = province.center;
    setRelation(s.state, SPAIN, ownerId, 'allied');
    s.state.countries[SPAIN].warheads = 1;

    const result = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });

    expect(result).toMatchObject({ ok: false, reason: 'You cannot strike an allied province.' });
    expect(s.state.countries[SPAIN].warheads).toBe(1);
    expect(relationOf(s.state, SPAIN, ownerId)).toBe('allied');
  });

  it('accrues warheads while holding an Ordnance Workshop, and not without one', () => {
    const s = session();
    const own = world.provinces.find((p) => s.state.provinceOwners[p.id] === SPAIN)!;
    s.state.countries[SPAIN].warheads = 0;

    // No ordnance or missile site anywhere Spain holds — no accrual.
    for (const [pid, b] of Object.entries(s.state.provinceBuildings)) {
      if (s.state.provinceOwners[Number(pid)] === SPAIN) { b.ordnance = 0; b.missileSite = 0; }
    }
    stepWarheads(s, HOURS_PER_WARHEAD + 1e-6);
    expect(s.state.countries[SPAIN].warheads).toBe(0);

    // With one, just over a warhead's worth of game-hours yields one.
    s.state.provinceBuildings[own.id] = { barracks: 1, tankPlant: 0, ordnance: 1, missileSite: 0 };
    stepWarheads(s, HOURS_PER_WARHEAD + 1e-6);
    expect(Math.floor(s.state.countries[SPAIN].warheads ?? 0)).toBe(1);
  });

  it('a Missile Site accrues warheads on its own', () => {
    const s = session();
    const own = world.provinces.find((p) => s.state.provinceOwners[p.id] === SPAIN)!;
    s.state.countries[SPAIN].warheads = 0;
    for (const [pid, b] of Object.entries(s.state.provinceBuildings)) {
      if (s.state.provinceOwners[Number(pid)] === SPAIN) { b.ordnance = 0; b.missileSite = 0; }
    }
    s.state.provinceBuildings[own.id] = { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 1 };
    stepWarheads(s, HOURS_PER_WARHEAD + 1e-6);
    expect(Math.floor(s.state.countries[SPAIN].warheads ?? 0)).toBe(1);
  });

  it('refuses to launch without a Missile Site, and when the target is out of range', () => {
    const s = session();
    const { province } = foreignProvince(s);
    const [x, z] = province.center;
    s.state.countries[SPAIN].warheads = 2;
    for (const b of Object.values(s.state.provinceBuildings)) b.missileSite = 0;

    const noSite = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });
    expect(noSite).toMatchObject({ ok: false });
    expect(s.state.countries[SPAIN].warheads).toBe(2);

    // A site exists but nowhere near the target — still refused, warhead kept.
    const far = world.provinces
      .filter((p) => s.state.provinceOwners[p.id] === SPAIN)
      .sort((a, b) =>
        Math.hypot(b.center[0] - x, b.center[1] - z) - Math.hypot(a.center[0] - x, a.center[1] - z))[0];
    s.state.provinceBuildings[far.id] = { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 1 };
    const outOfRange = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });
    if (Math.hypot(far.center[0] - x, far.center[1] - z) > 3200) {
      expect(outOfRange).toMatchObject({ ok: false });
      expect(s.state.countries[SPAIN].warheads).toBe(2);
    }
  });

  it('launches when a Missile Site is within range', () => {
    const s = session();
    const { province, ownerId } = strikeableForeignProvince(s);
    const [x, z] = province.center;
    s.state.countries[SPAIN].warheads = 1;

    const res = s.applyCommand({ type: 'strike', countryId: SPAIN, provinceId: province.id, x, z });
    expect(res.ok).toBe(true);
    expect(res.strike).toMatchObject({ attacker: SPAIN, defender: ownerId, provinceId: province.id });
    expect(s.state.countries[SPAIN].warheads).toBe(0);
  });
});
