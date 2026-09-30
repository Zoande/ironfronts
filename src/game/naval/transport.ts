/**
 * Temporary naval manifestations for land armies.
 *
 * This module deliberately knows nothing about ferry edges or route graphs.
 * A transport is a sea-domain unit manifestation; movement decides when it is
 * created and dismissed, while combat/save/projection code can use it without
 * depending on the current navigation implementation.
 */

import type { CountryState } from '../game-state';
import type { ArmyStack, UnitGroup } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { DamageProfile } from '../units/unit-types';

export type CombatDomain = 'land' | 'naval';
export type NavalUnitKind = 'transport' | 'battleship' | 'submarine';
export type NavalTargetClass = 'surface' | 'submarine';

export interface NavalUnitStats {
  readonly kind: NavalUnitKind;
  readonly level: number;
  readonly targetClass: NavalTargetClass;
  /** HP of one vessel. */
  readonly maxHp: number;
  /** World units per game hour. Sea movement applies no road/terrain bonus. */
  readonly speed: number;
  readonly attack: DamageProfile;
  readonly defense: DamageProfile;
  readonly visionOuter: number;
  readonly visionInner: number;
}

export interface TransportCargoGroup {
  /** The unique underlying land group this set of ships carries. */
  readonly cargoTypeId: string;
  /** One entry per surviving cargo unit / transport ship. */
  shipHp: number[];
}

export interface TransportManifestation {
  readonly kind: 'transport';
  /** Snapshotted when embarkation begins; never changes during the crossing. */
  readonly level: number;
  cargo: TransportCargoGroup[];
}

const TRANSPORT_MAX_HP = [0, 10, 12, 14, 16, 19, 22, 26, 30] as const;
const TRANSPORT_SPEED = [0, 100, 104, 108, 112, 117, 122, 128, 135] as const;

/** Level 1-8 transport technology. Transports are fragile surface vessels with
 * modest defensive armament; later native naval units can implement the same
 * NavalUnitStats contract without becoming cargo manifestations. */
export const TRANSPORT_TYPES: readonly NavalUnitStats[] = Array.from(
  { length: 8 },
  (_, index): NavalUnitStats => {
    const level = index + 1;
    const firepower = Math.round((0.8 + index * 0.2) * 100) / 100;
    return {
      kind: 'transport',
      level,
      targetClass: 'surface',
      maxHp: TRANSPORT_MAX_HP[level],
      speed: TRANSPORT_SPEED[level],
      attack: { soft: firepower, light: firepower * 0.6, heavy: firepower * 0.3 },
      defense: { soft: firepower * 1.25, light: firepower * 0.75, heavy: firepower * 0.4 },
      visionOuter: 210 + index * 8,
      visionInner: 100 + index * 5,
    };
  },
);

export function transportType(level: number): NavalUnitStats {
  const normalized = Math.max(1, Math.min(8, Math.trunc(level)));
  return TRANSPORT_TYPES[normalized - 1];
}

export function countryTransportLevel(country: CountryState | undefined): number {
  return Math.max(1, Math.min(8, Math.trunc(country?.technologies?.navy ?? 1)));
}

export function createTransportManifestation(
  army: ArmyStack, level: number,
): TransportManifestation {
  const stats = transportType(level);
  return {
    kind: 'transport',
    level: stats.level,
    cargo: army.units.filter((group) => group.count > 0 && group.hp > 0).map((group) => {
      const landMaxHp = group.count * unitType(group.typeId).maxHp;
      const fraction = landMaxHp > 0 ? Math.max(0, Math.min(1, group.hp / landMaxHp)) : 0;
      return {
        cargoTypeId: group.typeId,
        shipHp: Array.from({ length: group.count }, () => stats.maxHp * fraction),
      };
    }),
  };
}

export function beginTransportManifestation(
  army: ArmyStack, country: CountryState | undefined,
): TransportManifestation {
  const transport = createTransportManifestation(army, countryTransportLevel(country));
  army.transport = transport;
  return transport;
}

export function transportShipCount(transport: TransportManifestation): number {
  return transport.cargo.reduce((sum, group) => sum + group.shipHp.length, 0);
}

export function transportHp(transport: TransportManifestation): number {
  return transport.cargo.reduce(
    (sum, group) => sum + group.shipHp.reduce((groupSum, hp) => groupSum + hp, 0), 0,
  );
}

export function transportMaxHp(transport: TransportManifestation): number {
  return transportShipCount(transport) * transportType(transport.level).maxHp;
}

export function transportHealthFraction(transport: TransportManifestation): number {
  const maximum = transportMaxHp(transport);
  return maximum > 0 ? transportHp(transport) / maximum : 0;
}

/** Reflect ship damage/casualties back onto the underlying land scale without
 * ever storing naval HP in UnitGroup.hp. */
export function syncCargoFromTransport(army: ArmyStack): void {
  const transport = army.transport;
  if (!transport) return;
  const shipMaxHp = transportType(transport.level).maxHp;
  const cargoByType = new Map(transport.cargo.map((group) => [group.cargoTypeId, group]));
  const survivors: UnitGroup[] = [];
  for (const landGroup of army.units) {
    const cargo = cargoByType.get(landGroup.typeId);
    if (!cargo) continue;
    cargo.shipHp = cargo.shipHp.filter((hp) => hp > 1e-9);
    if (!cargo.shipHp.length) continue;
    const landMaxHp = unitType(landGroup.typeId).maxHp;
    landGroup.count = cargo.shipHp.length;
    landGroup.hp = cargo.shipHp.reduce(
      (sum, hp) => sum + Math.max(0, Math.min(1, hp / shipMaxHp)) * landMaxHp, 0,
    );
    survivors.push(landGroup);
  }
  army.units = survivors;
  transport.cargo = transport.cargo.filter((group) => group.shipHp.length > 0);
}

/** Apply damage to one cargo-owned vessel group. The weakest ship takes the
 * next hit, giving deterministic individual casualties while retaining pooled
 * land groups outside the naval manifestation. Returns unapplied overkill. */
export function damageTransportCargo(
  army: ArmyStack, cargoTypeId: string, amount: number,
): number {
  const transport = army.transport;
  if (!transport || !(amount > 0)) return Math.max(0, amount);
  const cargo = transport.cargo.find((group) => group.cargoTypeId === cargoTypeId);
  if (!cargo) return amount;
  let remaining = amount;
  cargo.shipHp.sort((a, b) => a - b);
  while (remaining > 1e-9 && cargo.shipHp.length) {
    const applied = Math.min(remaining, cargo.shipHp[0]);
    cargo.shipHp[0] -= applied;
    remaining -= applied;
    if (cargo.shipHp[0] <= 1e-9) cargo.shipHp.shift();
  }
  syncCargoFromTransport(army);
  return remaining;
}

/** Damage a whole transport formation while retaining the owning cargo group
 * for every casualty. Damage is assigned to the currently weakest ship. */
export function damageTransport(army: ArmyStack, amount: number): number {
  let remaining = Math.max(0, amount);
  while (remaining > 1e-9 && army.transport?.cargo.length) {
    const weakest = army.transport.cargo
      .flatMap((cargo) => cargo.shipHp.map((hp) => ({ cargo, hp })))
      .sort((a, b) => a.hp - b.hp || a.cargo.cargoTypeId.localeCompare(b.cargo.cargoTypeId))[0];
    if (!weakest) break;
    const applied = Math.min(remaining, weakest.hp);
    damageTransportCargo(army, weakest.cargo.cargoTypeId, applied);
    remaining -= applied;
  }
  return remaining;
}

export function endTransportManifestation(army: ArmyStack): void {
  syncCargoFromTransport(army);
  army.transport = null;
}

/** Underway and unloading formations are sea-domain targets. Embarking troops
 * have reserved ships, but remain land-domain until they leave the port. */
export function combatDomain(army: ArmyStack): CombatDomain {
  return army.transport && (army.status === 'atSea' || army.status === 'disembarking')
    ? 'naval' : 'land';
}

export function activeTransportStats(army: ArmyStack): NavalUnitStats | null {
  return army.transport ? transportType(army.transport.level) : null;
}
