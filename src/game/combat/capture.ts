import { armyAtNode } from '../movement/position';
/** Province-center capture and capture-side cleanup. */

import { relationOf } from '../game-state';
import type { SimContext } from '../sim-context';
import { wrappedDistance } from '../geometry';
import { COMBAT_SNAP } from './constants';
import { provinceAtNode } from './location';
import type { ArmyStack } from '../units/army';

export interface CaptureEvent {
  readonly provinceId: number;
  readonly fromCountryId: number;
  readonly toCountryId: number;
}

/** Capture the province at an army's current graph node. Kept separate so the
 * movement loop can claim an undefended centre at the instant it is crossed,
 * even when the same tick continues toward a later pursuit waypoint. */
export function captureProvinceAtArmyNode(
  session: SimContext, army: ArmyStack,
): CaptureEvent | null {
  if (!armyAtNode(session, army) || army.status === 'engaged' || army.status === 'retreating') return null;
  const provinceId = provinceAtNode(session, army.graphNodeId);
  if (provinceId === null) return null;
  const owner = session.state.provinceOwners[provinceId] ?? 0;
  if (owner === army.ownerCountryId || (
    owner > 0 && relationOf(session.state, army.ownerCountryId, owner) !== 'war'
  )) return null;

  // A city changes hands only when nobody is physically defending it. Strike
  // devastation weakens a garrison in stepCombat, but never bypasses it.
  const defended = Object.values(session.state.armies).some((other) => (
    other.id !== army.id && other.ownerCountryId === owner
    && wrappedDistance(other.x, other.z, army.x, army.z, session.world.width) <= COMBAT_SNAP
  ));
  if (defended) return null;
  session.state.provinceOwners[provinceId] = army.ownerCountryId;
  delete session.state.productionQueues[provinceId];
  delete session.state.constructionQueues[provinceId];
  delete session.state.rallyPoints[provinceId];
  for (const node of Object.values(session.state.resourceNodes)) {
    if (node.provinceId !== provinceId) continue;
    node.controllerCountryId = army.ownerCountryId;
    const extractor = node.extractorArmyId ? session.state.armies[node.extractorArmyId] : undefined;
    if (extractor && extractor.ownerCountryId !== army.ownerCountryId) {
      extractor.extractingNodeId = null;
      if (extractor.status === 'extracting') extractor.status = 'idle';
      node.extractorArmyId = null;
      node.status = node.remaining > 0 ? 'idle' : 'exhausted';
    }
  }
  return { provinceId, fromCountryId: owner, toCountryId: army.ownerCountryId };
}

export function stepCapture(session: SimContext): CaptureEvent[] {
  const events: CaptureEvent[] = [];
  for (const army of Object.values(session.state.armies)) {
    const event = captureProvinceAtArmyNode(session, army);
    if (event) events.push(event);
  }
  return events;
}
