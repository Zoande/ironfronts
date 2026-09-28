import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from '../units/army';
import { ensureArmyRuntimeState } from '../units/army';
import { occupiedEdge, routeFromArmy } from './position';
import { nearestNode, nearestRoadPosition, type LandGraph, type RoadPosition } from './graph';
import { relationOf, setRelation } from '../game-state';
import { movementEdgeAllowed, warsRequiredForPath } from './policy';
import { combinedGraph, isNavalStatus } from './naval';
import { armyParticipatesInFront } from '../combat/membership';
import { movementEdgeTravelCost } from './speed';
import { wrappedDistance, wrapX } from '../geometry';
import { routeToRoadPosition } from './road-route';

/** A final open-water leg must stay in water; the sea graph supplies its approach. */
function clearSeaLeg(session: SimContext, from: number, x: number, z: number): boolean {
  let dx = x - session.graph.nodeX[from];
  const width = session.world.width;
  if (dx > width / 2) dx -= width;
  else if (dx < -width / 2) dx += width;
  const dz = z - session.graph.nodeZ[from];
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 12));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    // Port nodes can sit a few units inland on the coast.
    if (t * Math.hypot(dx, dz) < 18) continue;
    if (session.world.provinceAt(wrapX(session.graph.nodeX[from] + dx * t, width),
      session.graph.nodeZ[from] + dz * t) >= 0) return false;
  }
  return true;
}

export interface MoveOrderResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}

export interface ExactMoveGoal {
  readonly graph: LandGraph;
  readonly nodeId?: number;
  readonly roadPosition?: RoadPosition;
}

export function installOrder(
  army: ArmyStack, path: readonly number[], destX: number, destZ: number,
  intent: 'move' | 'attack', target?: MoveOrder['target'],
  roadDestination?: MoveOrder['roadDestination'],
  seaDestination?: MoveOrder['seaDestination'],
): void {
  if (army.status === 'atSea' && army.navalCrossing
    && army.navalCrossing.fromNodeId === army.navalCrossing.toNodeId) {
    army.navalCrossing.returningToAnchor = true;
  }
  army.order = { path: path.slice(1), destX, destZ, intent, target, roadDestination, seaDestination, edgeProgress: 0 };
  army.suspendedOrder = null;
  if (army.status !== 'atSea') army.status = 'moving';
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
  if (isNavalStatus(army.status) && !(army.status === 'atSea'
    && army.navalCrossing?.fromNodeId === army.navalCrossing?.toNodeId && !army.order)) {
    return { ok: false, reason: 'Army is mid sea crossing.' };
  }

  const merged = combinedGraph(session.graph);
  type Candidate = { graph: LandGraph; goal?: number; road?: RoadPosition; sea?: boolean };
  const nodeTarget = target?.kind === 'army';
  const candidates: Candidate[] = exactGoal
    ? [{ graph: exactGoal.graph, goal: exactGoal.nodeId, road: exactGoal.roadPosition }]
    : nodeTarget ? [
      {
        graph: session.graph,
        goal: nearestNode(
          session.graph, destX, destZ, 600,
          session.graph.component[army.graphNodeId] ?? -1,
        ),
      },
      {
        graph: merged,
        goal: nearestNode(
          merged, destX, destZ, 600, merged.component[army.graphNodeId] ?? -1,
        ),
      },
    ] : (() => {
      if (session.world.provinceAt(destX, destZ) < 0) {
        const seaNodes: Array<{ node: number; distance: number }> = [];
        for (let node = 0; node < merged.nodeCount; node += 1) {
          if (!merged.seaAdjacency[node]?.length
            || merged.component[node] !== merged.component[army.graphNodeId]) continue;
          const distance = wrappedDistance(merged.nodeX[node], merged.nodeZ[node], destX, destZ, merged.width);
          seaNodes.push({ node, distance });
        }
        seaNodes.sort((a, b) => a.distance - b.distance);
        const seaCandidates: Candidate[] = [];
        for (const { node } of seaNodes) {
          if (clearSeaLeg(session, node, destX, destZ)) {
            seaCandidates.push({ graph: merged, goal: node, sea: true });
            if (seaCandidates.length === 12) break;
          }
        }
        return seaCandidates;
      }
      const landRoad = nearestRoadPosition(session.graph, destX, destZ, 600) ?? undefined;
      const combinedRoad = nearestRoadPosition(merged, destX, destZ, 600) ?? undefined;
      const roadCandidates: Candidate[] = [
        { graph: session.graph, road: landRoad },
        { graph: merged, road: combinedRoad },
      ];
      // A pure ferry fixture (or a migrated node-only graph) has no land road
      // geometry to snap to. Its coastal endpoint remains a valid exact graph
      // destination; generated worlds continue to require a road position.
      if (!landRoad && !combinedRoad && !(session.graph.edges?.length > 0)) {
        roadCandidates.push({ graph: merged, goal: nearestNode(
          merged, destX, destZ, 600, merged.component[army.graphNodeId] ?? -1,
        ) });
      }
      return roadCandidates;
    })();
  const adjustedGoal = (goal: number): number => {
    if (target?.kind !== 'army' || goal !== army.graphNodeId) return goal;
    const opponent = session.state.armies[target.armyId];
    return opponent ? (opponent.edge?.to ?? opponent.order?.path[0] ?? goal) : goal;
  };
  type Planned = { graph: LandGraph; goal: number; path: number[]; destX: number; destZ: number;
    roadDestination?: MoveOrder['roadDestination']; seaDestination?: MoveOrder['seaDestination'] };
  const plan = (
    allowed: ReturnType<typeof movementEdgeAllowed> | undefined,
    prospectiveWars: ReadonlySet<number>,
  ): Planned | null => {
    for (const candidate of candidates) {
      const cost = movementEdgeTravelCost(session, army, candidate.graph, prospectiveWars);
      if (candidate.road) {
        const route = routeToRoadPosition(session, army, candidate.graph, candidate.road, allowed, prospectiveWars);
        if (route) return { graph: candidate.graph, goal: route.path[route.path.length - 1], ...route,
          destX: candidate.road.x, destZ: candidate.road.z };
        continue;
      }
      const goal = adjustedGoal(candidate.goal ?? -1);
      if (goal < 0) continue;
      const path = routeFromArmy(session, army, goal, allowed, candidate.graph, cost);
      if (path) return { graph: candidate.graph, goal, path,
        destX: candidate.sea ? destX : candidate.graph.nodeX[goal],
        destZ: candidate.sea ? destZ : candidate.graph.nodeZ[goal],
        ...(candidate.sea ? { seaDestination: { x: destX, z: destZ, anchorNodeId: goal } } : {}) };
    }
    return null;
  };

  const forced = new Set(forcedWarCountryIds.filter((countryId) => (
    countryId > 0 && countryId !== army.ownerCountryId
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'war'
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'allied'
  )));
  // Existing wars/allies (plus a mandatory target war) get absolute routing
  // priority. A neutral shortcut is considered only when neither a land route
  // nor a naval route works without opening an additional war.
  const preferred = plan(
    movementEdgeAllowed(session, army.ownerCountryId, false, forced), forced,
  );
  const everyPotentialEnemy = new Set(Object.keys(session.state.countries)
    .map(Number).filter((countryId) => countryId !== army.ownerCountryId
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'allied'));
  const fallback = preferred ?? plan(undefined, everyPotentialEnemy);
  if (!fallback) {
    if (exactGoal) return { ok: false, reason: 'No legal route to that location.' };
    if (session.world.provinceAt(destX, destZ) < 0) return {
      ok: false, reason: 'No usable sea route reaches that water.' };
    const anyGoal = nearestRoadPosition(merged, destX, destZ, 600);
    return !anyGoal
      ? { ok: false, reason: 'That destination is off the road network; pick a spot on land.' }
      : { ok: false, reason: 'That destination is on a separate landmass with no usable naval crossing.' };
  }

  const anchoredOffshore = army.status === 'atSea'
    && army.navalCrossing?.fromNodeId === army.navalCrossing?.toNodeId;
  const alreadyThere = fallback.path.length < 2 && !fallback.seaDestination && !anchoredOffshore;
  if (alreadyThere && intent === 'move') return { ok: false, reason: 'Already there.' };
  const required = new Set(forced);
  if (!preferred) {
    for (const countryId of warsRequiredForPath(
      session, army.ownerCountryId, fallback.path,
    )) required.add(countryId);
  }
  const confirmed = new Set(confirmedWarCountryIds);
  const missing = [...required].sort((a, b) => a - b).filter((id) => !confirmed.has(id));
  if (missing.length) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: missing };
  }
  const legal = plan(
    movementEdgeAllowed(session, army.ownerCountryId, false, required), required,
  );
  if (!legal || (!alreadyThere && legal.path.length < 2 && !legal.seaDestination && !anchoredOffshore)) {
    return { ok: false, reason: 'No legal route to that location.' };
  }
  for (const countryId of required) setRelation(session.state, army.ownerCountryId, countryId, 'war');
  const edge = occupiedEdge(session, army);
  army.edge = edge;
  if (alreadyThere && target?.kind !== 'army') {
    army.order = null;
    if (army.status === 'moving') army.status = 'idle';
    return { ok: true, nodes: 0 };
  }
  installOrder(
    army, legal.path, legal.destX, legal.destZ, intent,
    target ?? { kind: 'position', x: destX, z: destZ },
    legal.roadDestination,
    legal.seaDestination,
  );
  return { ok: true, nodes: legal.path.length - 1 };
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
