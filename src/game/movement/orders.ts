import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from '../units/army';
import { ensureArmyRuntimeState } from '../units/army';
import { occupiedEdge, routeFromArmy } from './position';
import { nearestNode, type LandGraph } from './graph';
import { relationOf, setRelation } from '../game-state';
import { movementEdgeAllowed, warsRequiredForPath } from './policy';
import { combinedGraph, isNavalStatus } from './naval';
import { armyParticipatesInFront } from '../combat/membership';

export interface MoveOrderResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}

export interface ExactMoveGoal {
  readonly graph: LandGraph;
  readonly nodeId: number;
}

export function installOrder(
  army: ArmyStack, path: readonly number[], destX: number, destZ: number,
  intent: 'move' | 'attack', target?: MoveOrder['target'],
): void {
  army.order = { path: path.slice(1), destX, destZ, intent, target, edgeProgress: 0 };
  army.suspendedOrder = null;
  army.status = 'moving';
  army.extractingNodeId = null;
  army.extractionAssignment = null;
}

/** Create a route and atomically declare every confirmed transit war. */
export function issueMoveOrder(
  session: SimContext, armyId: string, destX: number, destZ: number,
  intent: 'move' | 'attack' = 'move', target?: MoveOrder['target'],
  confirmedWarCountryIds: readonly number[] = [],
  forcedWarCountryIds: readonly number[] = [],
  exactGoal?: ExactMoveGoal,
): MoveOrderResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  ensureArmyRuntimeState(army);
  army.battleFrontIds = army.battleFrontIds!.filter((frontId) => {
    const front = session.state.battleFronts[frontId];
    return Boolean(front && armyParticipatesInFront(army.id, front));
  });
  if (army.status === 'engaged' && army.battleFrontIds!.length === 0) army.status = 'idle';
  if (army.status === 'engaged') return { ok: false, reason: 'Army is in close combat.' };
  if (army.status === 'retreating') return { ok: false, reason: 'Army is retreating.' };
  if (isNavalStatus(army.status)) return { ok: false, reason: 'Army is mid sea crossing.' };

  let graph: LandGraph = exactGoal?.graph ?? session.graph;
  let goal = exactGoal?.nodeId ?? nearestNode(
    graph, destX, destZ, 600, graph.component[army.graphNodeId] ?? -1,
  );
  if (target?.kind === 'army' && goal === army.graphNodeId) {
    const opponent = session.state.armies[target.armyId];
    if (opponent) goal = opponent.edge?.to ?? opponent.order?.path[0] ?? goal;
  }
  let unrestricted = goal >= 0
    ? routeFromArmy(session, army, goal, undefined, graph) : null;
  if (!unrestricted && !exactGoal) {
    const merged = combinedGraph(session.graph);
    const mergedGoal = nearestNode(
      merged, destX, destZ, 600, merged.component[army.graphNodeId] ?? -1,
    );
    const mergedRoute = mergedGoal >= 0
      ? routeFromArmy(session, army, mergedGoal, undefined, merged) : null;
    if (mergedRoute) {
      graph = merged;
      goal = mergedGoal;
      unrestricted = mergedRoute;
    }
  }
  if (goal < 0 || !unrestricted) {
    if (exactGoal) return { ok: false, reason: 'No legal route to that location.' };
    const anyGoal = nearestNode(combinedGraph(session.graph), destX, destZ, 600, -1);
    return anyGoal < 0
      ? { ok: false, reason: 'That destination is off the road network; pick a spot on land.' }
      : { ok: false, reason: 'That destination is on a separate landmass with no usable naval crossing.' };
  }

  const alreadyThere = unrestricted.length < 2;
  if (alreadyThere && intent === 'move') return { ok: false, reason: 'Already there.' };
  const currentlyLegal = routeFromArmy(
    session, army, goal, movementEdgeAllowed(session, army.ownerCountryId), graph,
  );
  const required = new Set(currentlyLegal
    ? [] : warsRequiredForPath(session, army.ownerCountryId, unrestricted));
  for (const countryId of forcedWarCountryIds) {
    if (countryId > 0 && countryId !== army.ownerCountryId
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'war'
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'allied') {
      required.add(countryId);
    }
  }
  const confirmed = new Set(confirmedWarCountryIds);
  const missing = [...required].sort((a, b) => a - b).filter((id) => !confirmed.has(id));
  if (missing.length) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: missing };
  }
  const legal = currentlyLegal ?? routeFromArmy(
    session, army, goal,
    movementEdgeAllowed(session, army.ownerCountryId, false, required), graph,
  );
  if (!legal || (!alreadyThere && legal.length < 2)) {
    return { ok: false, reason: 'No legal route to that location.' };
  }
  for (const countryId of required) setRelation(session.state, army.ownerCountryId, countryId, 'war');
  const edge = occupiedEdge(session, army);
  if (edge) army.edge = edge;
  if (alreadyThere && target?.kind !== 'army') {
    army.order = null;
    if (army.status === 'moving') army.status = 'idle';
    return { ok: true, nodes: 0 };
  }
  installOrder(
    army, legal, graph.nodeX[goal], graph.nodeZ[goal], intent,
    target ?? { kind: 'position', x: destX, z: destZ },
  );
  return { ok: true, nodes: legal.length - 1 };
}

export function issueStop(session: SimContext, armyId: string): boolean {
  const army = session.state.armies[armyId];
  if (!army) return false;
  ensureArmyRuntimeState(army);
  if (army.status === 'engaged' || army.status === 'retreating' || isNavalStatus(army.status)) {
    return false;
  }
  army.edge = occupiedEdge(session, army);
  army.order = null;
  army.suspendedOrder = null;
  army.extractingNodeId = null;
  army.extractionAssignment = null;
  if (army.status === 'moving' || army.status === 'extracting') army.status = 'idle';
  return true;
}
