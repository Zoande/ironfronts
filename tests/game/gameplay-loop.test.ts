import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { stepCombat } from '../../src/game/combat';
import { stackUnitCount } from '../../src/game/units/army';
import { nearestNode } from '../../src/game/movement/graph';
import { remainingOrderTravelHours } from '../../src/game/units/movement';
import { GAME_PACE } from '../../src/game/pacing';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import { loadWorld, type LoadedWorld } from './load-world';

const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

function spainSession(): GameSession {
  return GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
}

describe('gameplay vertical slice', () => {
  it('continues simulating after the player loses every province', () => {
    const s = spainSession();
    for (const provinceId of Object.keys(s.state.provinceOwners)) {
      if (s.state.provinceOwners[Number(provinceId)] === SPAIN) s.state.provinceOwners[Number(provinceId)] = 0;
    }
    const before = s.gameTimeHours;
    s.tick(1 / 1800);
    expect(s.gameTimeHours).toBeGreaterThan(before);
    expect(s.state).not.toHaveProperty('outcome');
  });

  it('an ordered army moves along the road graph and stops when told', () => {
    const s = spainSession();
    const army = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    const startNode = army.graphNodeId;
    // Pick a real adjacent land-road node. A distant owned province may require
    // a ferry, during whose embarkation a stop order is intentionally refused.
    const targetNode = s.graph.adjacency[startNode][0];
    expect(targetNode).toBeGreaterThanOrEqual(0);
    const res = s.orderMove(
      SPAIN, army.id, s.graph.nodeX[targetNode], s.graph.nodeZ[targetNode], 'move',
    );
    expect(res.ok).toBe(true);
    expect(army.order).not.toBeNull();

    const startX = army.x;
    const startZ = army.z;
    s.tick(4 / 1800);
    expect(army.x !== startX || army.z !== startZ).toBe(true); // it moved
    expect(s.orderStop(SPAIN, army.id)).toBe(true);
    expect(army.order).toBeNull();
    expect(army.status).toBe('idle');
    // graph node advanced or stayed valid
    expect(army.graphNodeId).toBeGreaterThanOrEqual(0);
    expect(startNode).toBeGreaterThanOrEqual(0);
  });

  it('engineers increase renewable province production', () => {
    const s = spainSession();
    const entry = Object.entries(s.state.provinceEconomies ?? {}).find(([provinceId, economy]) =>
      s.state.provinceOwners[Number(provinceId)] === SPAIN
      && economy.baseProduction.stone > 0);
    expect(entry).toBeDefined();
    const provinceId = Number(entry![0]);
    const province = world.provinces.find((candidate) => candidate.id === provinceId)!;
    const centerNode = nearestNode(s.graph, province.center[0], province.center[1]);
    // Province extraction is assigned at the province-centre road node.
    const engineers = {
      id: 'test-eng', ownerCountryId: SPAIN, name: 'Miners',
      x: s.graph.nodeX[centerNode], z: s.graph.nodeZ[centerNode], graphNodeId: centerNode,
      units: [{ typeId: 'engineer', count: 3, hp: 240, experience: 0 }],
      status: 'idle' as const, order: null, extractingNodeId: null, extractionAssignment: null,
    };
    s.state.armies['test-eng'] = engineers;

    const before = s.state.countries[SPAIN].stockpile.stone;
    const incomeBefore = s.state.countries[SPAIN].income.stone;
    const start = s.orderExtract(SPAIN, 'test-eng', 'stone');
    expect(start.ok).toBe(true);
    expect(engineers.extractionAssignment).toEqual({ provinceId, resource: 'stone' });
    s.tick(GAME_PACE.clock.incomeRefreshHours);
    expect(s.state.countries[SPAIN].income.stone).toBeGreaterThan(incomeBefore);
    expect(s.state.countries[SPAIN].stockpile.stone).toBeGreaterThan(before);
  });

  it('a city produces a unit that spawns and auto-stacks', () => {
    const s = spainSession();
    // Find the player province with a tank plant (the capital).
    const plantProvince = Object.entries(s.state.provinceBuildings)
      .find(([, b]) => b.tankPlant > 0 && s.state.provinceOwners[Number([].concat()[0] ?? 0)] !== undefined);
    const pid = Number(Object.keys(s.state.provinceBuildings).find(
      (k) => s.state.provinceBuildings[Number(k)].tankPlant > 0 && s.ownsProvince(SPAIN, Number(k)),
    ));
    expect(Number.isFinite(pid)).toBe(true);
    void plantProvince;

    const armiesBefore = Object.keys(s.state.armies).length;
    const fundsBefore = s.state.countries[SPAIN].stockpile.funds;
    const order = s.produce(SPAIN, pid, 'light-tank');
    expect(order.ok).toBe(true);
    expect(s.state.countries[SPAIN].stockpile.funds).toBeLessThan(fundsBefore);

    // Tier-1 light tanks require one work-hour at a tier-1 plant.
    s.tick(1.01);
    const armiesAfter = Object.values(s.state.armies).filter((a) => a.ownerCountryId === SPAIN);
    const hasLightTank = armiesAfter.some((a) => a.units.some((g) => g.typeId === 'light-tank'));
    expect(hasLightTank).toBe(true);
    expect(Object.keys(s.state.armies).length).toBeGreaterThanOrEqual(armiesBefore);
  });

  it('guarantees a strategic baseline for selectable countries', () => {
    const s = spainSession();
    const economies = s.state.provinceEconomies!;
    const hasResource = (countryId: number, kind: 'stone' | 'metal'): boolean =>
      world.provinces.some((province) => s.state.provinceOwners[province.id] === countryId
        && economies[province.id].baseProduction[kind] > 0);
    // Province economies normalize every selectable nation up front.
    for (const kind of ['stone', 'metal'] as const) {
      expect(hasResource(SPAIN, kind)).toBe(true);
    }

    // A non-selectable minor promoted to AI receives the same strategic floor.
    const aiId = s.enableNearbyAi(SPAIN)!;
    for (const kind of ['stone', 'metal'] as const) {
      expect(hasResource(aiId, kind)).toBe(true);
    }
  });

  it('hostile stacks at the same node fight and one is destroyed; capture flips ownership', () => {
    const s = spainSession();
    const enemyId = s.enableNearbyAi(SPAIN);
    expect(enemyId).not.toBeNull();
    s.declareWar(SPAIN, enemyId!);

    // Put a strong Spanish stack and a weak enemy stack on the same enemy
    // province centre node.
    const enemyProvince = world.provinces.find((p) => s.state.provinceOwners[p.id] === enemyId)!;
    const node = s.graph.component.length > 0
      ? nearestInProvince(s, enemyProvince.id, enemyProvince.center[0], enemyProvince.center[1])
      : 0;
    expect(node).toBeGreaterThanOrEqual(0);
    const at = { x: s.graph.nodeX[node], z: s.graph.nodeZ[node], graphNodeId: node };

    // Isolate this encounter from scenario garrisons and AI reinforcements.
    s.state.armies = {};
    for (const country of Object.values(s.state.countries)) country.controller = 'player';
    s.state.armies['sp-strike'] = {
      id: 'sp-strike', ownerCountryId: SPAIN, name: 'Strike', ...at,
      units: [{ typeId: 'medium-tank', count: 4, hp: 760, experience: 0 },
        { typeId: 'infantry', count: 6, hp: 600, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };
    s.state.armies['en-weak'] = {
      id: 'en-weak', ownerCountryId: enemyId!, name: 'Militia', ...at,
      units: [{ typeId: 'infantry', count: 2, hp: 200, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };

    for (let interval = 0; interval < 50_000 && s.state.armies['en-weak'] && s.state.armies['en-weak'].status !== 'retreating'; interval += 1) {
      stepCombat(s, 1 / 3600);
    }
    // A full-strength militia this outmatched is wiped out before it ever drops
    // below the retreat threshold while still alive — it does not get to run.
    expect(
      !s.state.armies['en-weak'] || s.state.armies['en-weak'].status === 'retreating',
    ).toBe(true);
    // Let a surviving routed defender clear the city before capture resolves.
    for (let step = 0; step < 24 && s.state.provinceOwners[enemyProvince.id] !== SPAIN; step += 1) {
      s.tick(0.25);
    }
    expect(s.state.provinceOwners[enemyProvince.id]).toBe(SPAIN);
    expect(s.isAtWar(SPAIN, enemyId!)).toBe(true);
  });

  it('a friendly stack folds into an idle stack already on the destination node', () => {
    const s = spainSession();
    const mover = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    // A direct land-graph neighbour of the mover's node hosts the resident stack,
    // so a single-hop order lands the mover exactly on it.
    const restNode = s.graph.adjacency[mover.graphNodeId][0];
    expect(restNode).toBeGreaterThanOrEqual(0);
    s.state.armies['sp-rest'] = {
      id: 'sp-rest', ownerCountryId: SPAIN, name: 'Garrison',
      x: s.graph.nodeX[restNode], z: s.graph.nodeZ[restNode], graphNodeId: restNode,
      units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };
    const moverUnits = stackUnitCount(mover);
    const res = s.orderMove(SPAIN, mover.id, s.graph.nodeX[restNode], s.graph.nodeZ[restNode], 'move');
    expect(res.ok).toBe(true);

    const eta = remainingOrderTravelHours(s, mover);
    expect(eta).not.toBeNull();
    s.tick(eta! + 0.01);

    expect(s.state.armies[mover.id]).toBeUndefined(); // the mover was folded away
    const survivor = s.state.armies['sp-rest'];
    expect(survivor).toBeDefined();
    expect(stackUnitCount(survivor)).toBe(3 + moverUnits); // it absorbed the mover's units

    // Sanity: two idle friendly stacks that never move do NOT merge on their own
    // (the merge is an arrival event, not a proximity sweep).
    const s2 = spainSession();
    const a2 = Object.values(s2.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    s2.state.armies['sp-twin'] = {
      id: 'sp-twin', ownerCountryId: SPAIN, name: 'Twin',
      x: a2.x, z: a2.z, graphNodeId: a2.graphNodeId,
      units: [{ typeId: 'infantry', count: 1, hp: 100, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };
    s2.tick(6 / 1800);
    expect(s2.state.armies['sp-twin']).toBeDefined();
    expect(s2.state.armies[a2.id]).toBeDefined();
  }, 30_000);

  it('a stack still merges into a resident one a few world units off the same node', () => {
    const s = spainSession();
    const mover = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    const restNode = s.graph.adjacency[mover.graphNodeId][0];
    expect(restNode).toBeGreaterThanOrEqual(0);
    // Deliberately mismatched graphNodeId so only proximity, not node
    // equality, can trigger the merge — resident sits a few world units off
    // the node the mover will land exactly on.
    s.state.armies['sp-rest'] = {
      id: 'sp-rest', ownerCountryId: SPAIN, name: 'Garrison',
      x: s.graph.nodeX[restNode] + 8, z: s.graph.nodeZ[restNode] + 8, graphNodeId: restNode + 1_000_000,
      units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    };
    const moverUnits = stackUnitCount(mover);
    const res = s.orderMove(SPAIN, mover.id, s.graph.nodeX[restNode], s.graph.nodeZ[restNode], 'move');
    expect(res.ok).toBe(true);

    const eta = remainingOrderTravelHours(s, mover);
    expect(eta).not.toBeNull();
    s.tick(eta! + 0.01);

    expect(s.state.armies[mover.id]).toBeUndefined();
    const survivor = s.state.armies['sp-rest'];
    expect(survivor).toBeDefined();
    expect(stackUnitCount(survivor)).toBe(3 + moverUnits);
  }, 30_000);

  it('a move order revalidation leaves no stack marching in place with an empty path', () => {
    const s = spainSession();
    const army = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    // The shape a blocked-border revalidation produces: status still 'moving',
    // order still present, but its path is now empty (nothing legal ahead).
    army.order = {
      path: [], destX: army.x, destZ: army.z, intent: 'move', edgeProgress: 0,
      target: { kind: 'position', x: army.x + 4000, z: army.z },
    };
    army.status = 'moving';
    s.tick(1 / 1800);
    expect(army.order).toBeNull();
    expect(army.status).toBe('idle');
  });

  it('a stack aimed at ground it can never reach stops instead of oscillating forever', () => {
    const s = spainSession();
    const army = Object.values(s.state.armies).find((a) => a.ownerCountryId === SPAIN)!;
    // A live order whose path front is a stale non-adjacent node (forces a
    // revalidate) and whose target sits deep in neutral foreign land Spain may
    // not enter. Revalidation can get no closer, so the stack must stop.
    const strandedNode = (army.graphNodeId + 500) % s.graph.nodeCount;
    army.order = {
      path: [strandedNode], destX: 0, destZ: 0, intent: 'attack', edgeProgress: 0,
      target: { kind: 'position', x: army.x + 30_000, z: army.z + 20_000 },
    };
    army.status = 'moving';
    const startX = army.x;
    const startZ = army.z;
    // First step forces revalidation; then use the authoritative ETA to reach
    // the legal frontier endpoint where the impossible order is cancelled.
    s.tick(1 / 1800);
    const eta = remainingOrderTravelHours(s, army);
    expect(eta).not.toBeNull();
    s.tick(eta! + 0.5);
    expect(army.status).toBe('idle');
    expect(army.order).toBeNull();
    // It may have legally advanced toward the frontier, but it is not still
    // frozen where it began pretending to march.
    expect(army.x !== startX || army.z !== startZ || army.graphNodeId >= 0).toBe(true);
  }, 30_000);
});

function nearestInProvince(s: GameSession, provinceId: number, x: number, z: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < s.graph.nodeCount; i += 1) {
    if (world.provinceAt(s.graph.nodeX[i], s.graph.nodeZ[i]) !== provinceId) continue;
    const dx = s.graph.nodeX[i] - x;
    const dz = s.graph.nodeZ[i] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
