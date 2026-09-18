import { describe, expect, it } from 'vitest';
import {
  createTransportManifestation, damageTransportCargo, transportHealthFraction,
  endTransportManifestation, transportHp, transportMaxHp, transportType,
} from '../../src/game/naval/transport';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';

function mixedArmy(): ArmyStack {
  return {
    id: 'cargo', ownerCountryId: 1, name: 'Cargo', x: 0, z: 0, graphNodeId: 0,
    units: [makeGroup('infantry', 2, 0.5), makeGroup('medium-tank', 1, 1)],
    status: 'atSea', order: null, extractingNodeId: null,
  };
}

describe('transport manifestation', () => {
  it('defines a complete Level 1-8 progression beginning at 10 HP per ship', () => {
    expect(transportType(1).maxHp).toBe(10);
    for (let level = 2; level <= 8; level += 1) {
      expect(transportType(level).maxHp).toBeGreaterThan(transportType(level - 1).maxHp);
      expect(transportType(level).speed).toBeGreaterThan(transportType(level - 1).speed);
    }
  });

  it('converts cargo health percentages without replacing land HP with naval HP', () => {
    const army = mixedArmy();
    army.transport = createTransportManifestation(army, 1);

    expect(army.units.map((group) => group.hp)).toEqual([100, 190]);
    expect(army.transport.cargo[0].shipHp).toEqual([5, 5]);
    expect(army.transport.cargo[1].shipHp).toEqual([10]);
    expect(transportHp(army.transport)).toBe(20);
    expect(transportMaxHp(army.transport)).toBe(30);
    expect(transportHealthFraction(army.transport)).toBeCloseTo(2 / 3);
  });

  it('keeps mixed-stack casualties with their cargo group and restores land-scale HP', () => {
    const army = mixedArmy();
    army.transport = createTransportManifestation(army, 1);

    // One half-health infantry transport sinks; the other cargo groups are untouched.
    expect(damageTransportCargo(army, 'infantry', 5)).toBe(0);
    expect(army.units.find((group) => group.typeId === 'infantry')).toMatchObject({ count: 1, hp: 50 });
    expect(army.units.find((group) => group.typeId === 'medium-tank')).toMatchObject({ count: 1, hp: 190 });

    // A half-strength surviving tank transport maps back to 50% of 190 land HP.
    expect(damageTransportCargo(army, 'medium-tank', 5)).toBe(0);
    expect(army.units.find((group) => group.typeId === 'medium-tank')?.hp).toBeCloseTo(95);
    endTransportManifestation(army);
    expect(army.transport).toBeNull();
    expect(army.units.find((group) => group.typeId === 'medium-tank')?.hp).toBeCloseTo(95);
  });
});
