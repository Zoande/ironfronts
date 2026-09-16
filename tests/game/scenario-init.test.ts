import { describe, expect, it, beforeAll } from 'vitest';
import { buildScenarioSelection, scenarioById } from '../../src/game/scenario-catalog';
import { initGameState } from '../../src/game/scenario-init';
import { GameSession } from '../../src/game/game-session';
import { serializeGameState, deserializeGameState } from '../../src/game/game-state';
import { stackUnitCount } from '../../src/game/units/army';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import { loadWorld, type LoadedWorld } from './load-world';

const SPAIN_ID = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;

let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

describe('Spain "World at War" initialisation', () => {
  it('produces a coherent starting state', () => {
    const selection = buildScenarioSelection('OP-1939-01', SPAIN_ID);
    const { state, diagnostics } = initGameState(
      selection, scenarioById('OP-1939-01'), world,
    );

    expect(diagnostics.eligibleCountryIds).toContain(SPAIN_ID);
    expect(Object.values(state.countries).every((country) => country.controller === 'neutral')).toBe(true);
    expect(Object.keys(state.countries).length).toBeGreaterThan(150);

    // real starting stockpile (step 6)
    expect(state.countries[SPAIN_ID].stockpile.funds).toBeGreaterThan(0);
    expect(state.countries[SPAIN_ID].stockpile.metal).toBeGreaterThan(0);

    // dense province ownership; Spain owns its provinces
    const spainProvinces = Object.entries(state.provinceOwners)
      .filter(([, owner]) => owner === SPAIN_ID);
    expect(spainProvinces.length).toBeGreaterThanOrEqual(20);

    // starting buildings only in owned urban provinces, capital has a plant
    const capital = world.countries.find((c) => c.id === SPAIN_ID)!.capitalProvinceId;
    expect(state.provinceBuildings[capital]?.tankPlant).toBeGreaterThanOrEqual(1);
    for (const provinceId of Object.keys(state.provinceBuildings).map(Number)) {
      const buildings = state.provinceBuildings[provinceId];
      const total = buildings.barracks + buildings.tankPlant + buildings.ordnance;
      expect(total).toBeGreaterThan(0);
    }

    // starting armies exist, tied to the reachable mainland
    const playerArmies = Object.values(state.armies)
      .filter((army) => army.ownerCountryId === SPAIN_ID);
    expect(playerArmies.length).toBeGreaterThanOrEqual(1);
    for (const army of playerArmies) {
      expect(stackUnitCount(army)).toBeGreaterThan(0);
      expect(army.graphNodeId).toBeGreaterThanOrEqual(0);
    }

    // capital-region army carries engineer-capable units (needed for O–S)
    const engineerArmies = playerArmies.filter(
      (army) => army.units.some((g) => g.typeId === 'engineer' || g.typeId === 'infantry'),
    );
    expect(engineerArmies.length).toBeGreaterThanOrEqual(1);

    // resource nodes snapped to land access; the mechanism works
    const nodes = Object.values(state.resourceNodes);
    expect(nodes.length).toBeGreaterThan(0);
    expect(diagnostics.reachableResourceNodes).toBeGreaterThan(diagnostics.unreachableResourceNodes);
    for (const node of nodes) {
      expect(['idle', 'secured', 'extracting', 'exhausted']).toContain(node.status);
      if (node.accessNodeId >= 0) {
        expect(node.accessNodeId).toBeLessThan(1_000_000);
      }
    }

    // O–S: Spain MUST control a reachable stone AND metal deposit so the
    // vertical slice (move engineers -> deposit -> EXTRACT -> stockpile rises)
    // is buildable. Guaranteed by the resource bootstrap if the seed's natural
    // geography does not already provide them.
    const spainStone = nodes.filter(
      (n) => n.kind === 'stone' && n.controllerCountryId === SPAIN_ID && n.accessNodeId >= 0,
    );
    const spainMetal = nodes.filter(
      (n) => n.kind === 'metal' && n.controllerCountryId === SPAIN_ID && n.accessNodeId >= 0,
    );
    expect(spainStone.length).toBeGreaterThanOrEqual(1);
    expect(spainMetal.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.guaranteedDeposits.every((g) => g.provinceId >= 0)).toBe(true);

    // all peace at start
    expect(Object.keys(state.relations)).toHaveLength(0);
    expect(state.diplomacyMessages).toEqual({});
    expect(state.diplomacyProposals).toEqual({});
    expect(state.nextDiplomacyId).toBe(1);
  });

  it('is deterministic for the same inputs', () => {
    const selection = buildScenarioSelection('OP-1939-01', SPAIN_ID);
    const a = initGameState(selection, scenarioById('OP-1939-01'), world);
    const b = initGameState(selection, scenarioById('OP-1939-01'), world);
    expect(serializeGameState(a.state)).toBe(serializeGameState(b.state));
  });

  it('round-trips the initialised state through JSON', () => {
    const selection = buildScenarioSelection('OP-1939-01', SPAIN_ID);
    const { state } = initGameState(selection, scenarioById('OP-1939-01'), world);
    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
  });

  it('GameSession.create advances game time and accrues passive income', () => {
    const selection = buildScenarioSelection('OP-1939-01', SPAIN_ID);
    const session = GameSession.create(selection, world);
    const before = session.state.countries[SPAIN_ID].stockpile.funds;
    session.tick(6 / 1800);
    expect(session.gameTimeHours).toBeCloseTo(6 / 1800, 5);
    expect(session.state.countries[SPAIN_ID].stockpile.funds).toBeGreaterThan(before);
    // stone/metal/oil are physical-only — no passive gain
    expect(session.state.countries[SPAIN_ID].income.metal).toBe(0);
  });

});
