import { describe, expect, it, beforeAll } from 'vitest';
import { GameSession } from '../../src/game/game-session';
import { buildScenarioSelection } from '../../src/game/scenario-catalog';
import { CATALOG_COUNTRY_BY_NAME } from '../../src/game/data/countries.generated';
import {
  aiMemory, assess, combatStrength, indexArmies, indexProvinces,
} from '../../src/game/ai/assessment';
import { loadWorld, type LoadedWorld } from './load-world';

/**
 * The stubbed AI tests pin individual decisions; this one drives the real
 * `session.step()` on the real world so the whole loop is exercised against
 * genuine geography.
 *
 * The regression it guards: a small nation whose entire army IS its capital
 * garrison used to freeze forever, because no stack could ever be spared. It
 * must now split a field army off and still leave the capital covered.
 */
const SPAIN = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;
let world: LoadedWorld;
beforeAll(async () => { world = await loadWorld(); }, 60_000);

describe('AI on a live campaign', () => {
  it('mobilises a field army without uncovering its capital', () => {
    const session = GameSession.create(buildScenarioSelection('OP-1939-01', SPAIN), world);
    const ai = session.enableNearbyAi(SPAIN)!;
    session.declareWar(SPAIN, ai);

    const initial = assess(
      session, aiMemory(session.state), ai, indexArmies(session.state), indexProvinces(session),
    );
    const parent = initial.capital?.garrison[0];
    expect(parent).toBeDefined();
    const requiredStrength = Math.max(300, (initial.capital?.threatStrength ?? 0) * 1.5);
    const reinforcements = Math.ceil(
      Math.max(0, requiredStrength + 500 - combatStrength(parent!)) / 100,
    );
    const infantry = parent!.units.find((group) => group.typeId === 'infantry');
    if (infantry) {
      infantry.count += reinforcements;
      infantry.hp += reinforcements * 100;
    } else {
      parent!.units.push({
        typeId: 'infantry', count: reinforcements, hp: reinforcements * 100, experience: 0,
      });
    }
    for (const node of Object.values(session.state.resourceNodes)) {
      if (node.controllerCountryId !== ai) continue;
      node.remaining = 0;
      node.status = 'exhausted';
    }

    // A clear capital surplus reaches the live mobilise/split path directly;
    // long-run economy pacing is covered by focused economy and production tests.
    session.tick(3 / 1800);

    const situation = assess(
      session, aiMemory(session.state), ai, indexArmies(session.state), indexProvinces(session),
    );
    const capital = situation.capital;
    expect(capital).not.toBeNull();

    // It fielded more than the one stack it started the war sitting on.
    const fighting = situation.armies.filter((army) => combatStrength(army) > 0);
    expect(fighting.length).toBeGreaterThan(1);

    // The detached field stack immediately receives an authoritative order.
    expect(fighting.some((army) => army.id !== parent!.id && army.order !== null)).toBe(true);

    // ...and the capital is still covered against what is bearing down on it.
    const held = capital!.garrison.reduce((sum, army) => sum + combatStrength(army), 0);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeGreaterThanOrEqual(capital!.threatStrength);
  }, 120_000);
});
