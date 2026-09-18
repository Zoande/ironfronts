import type { SimContext } from '../sim-context';
import { armyAtNode } from '../movement/position';
import { wrappedDistance } from '../geometry';
import { resolveProvince } from '../resource-bootstrap';
import { edgeDistanceAtPoint, edgeIdBetween, edgePosition, edgePositionFrom } from '../movement/graph';
import { transportType } from '../naval/transport';
import { unitType } from '../units/unit-catalog';

/** Validate references after rebuilding immutable world indexes. */
export function validateWorldState(ctx: SimContext): void {
  const { state, graph, world } = ctx;
  const nodeExists = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < graph.nodeCount;
  const provinceIds = new Set(world.provinces.map((province) => province.id));
  const countryExists = (id: number): boolean => id === 0 || Boolean(state.countries[id]);
  const onEdge = (army: typeof state.armies[string], from: number, to: number): boolean => {
    const edgeId = edgeIdBetween(graph, from, to);
    if (edgeId < 0) return false;
    const distance = edgeDistanceAtPoint(graph, edgeId, from, army.x, army.z);
    const point = edgePositionFrom(graph, edgeId, from, distance);
    return wrappedDistance(point.x, point.z, army.x, army.z, world.width) < 0.1;
  };
  const onSeaEdge = (army: typeof state.armies[string], from: number, to: number): boolean => {
    const total = wrappedDistance(graph.nodeX[from], graph.nodeZ[from], graph.nodeX[to], graph.nodeZ[to], world.width);
    const travelled = wrappedDistance(graph.nodeX[from], graph.nodeZ[from], army.x, army.z, world.width);
    const remaining = wrappedDistance(army.x, army.z, graph.nodeX[to], graph.nodeZ[to], world.width);
    return Math.abs(travelled + remaining - total) < 0.1;
  };
  for (const [provinceId, owner] of Object.entries(state.provinceOwners)) {
    if (!provinceIds.has(Number(provinceId)) || !countryExists(owner)) throw new Error('Invalid province ownership.');
  }
  for (const army of Object.values(state.armies)) {
    if (!nodeExists(army.graphNodeId) || army.x < 0 || army.x >= world.width || army.z < 0 || army.z > world.height) throw new Error('Invalid army position.');
    const naval = army.status === 'embarking' || army.status === 'atSea' || army.status === 'disembarking';
    if (naval) {
      const crossing = army.navalCrossing;
      const transport = army.transport;
      if (!crossing || !transport || !nodeExists(crossing.fromNodeId) || !nodeExists(crossing.toNodeId)
        || !graph.seaAdjacency[crossing.fromNodeId]?.includes(crossing.toNodeId)
        || (army.status === 'embarking' && army.graphNodeId !== crossing.fromNodeId)
        || (army.status === 'atSea' && (army.graphNodeId !== crossing.fromNodeId
          || !onSeaEdge(army, crossing.fromNodeId, crossing.toNodeId)))
        || (army.status === 'disembarking' && army.graphNodeId !== crossing.toNodeId)) {
        throw new Error('Invalid naval crossing.');
      }
      const shipMaxHp = transportType(transport.level).maxHp;
      const landByType = new Map(army.units.map((group) => [group.typeId, group]));
      if (transport.cargo.length !== landByType.size || new Set(transport.cargo.map((group) => group.cargoTypeId)).size !== transport.cargo.length) {
        throw new Error('Invalid transport cargo.');
      }
      for (const cargo of transport.cargo) {
        const land = landByType.get(cargo.cargoTypeId);
        const expectedLandHp = cargo.shipHp.reduce(
          (sum, hp) => sum + hp / shipMaxHp * unitType(cargo.cargoTypeId).maxHp, 0,
        );
        if (!land || cargo.shipHp.length !== land.count || !cargo.shipHp.length
          || cargo.shipHp.some((hp) => !(hp > 0) || hp > shipMaxHp + 1e-6)
          || Math.abs(land.hp - expectedLandHp) > 1e-5) throw new Error('Invalid transport cargo.');
      }
    } else if (army.navalCrossing || army.transport) {
      throw new Error('Naval crossing has invalid status.');
    }
    if (!naval && !armyAtNode(ctx, army) && !army.edge) {
      // Recover the physical edge for stopped v2 armies, whose old saves lost it.
      const from = army.graphNodeId;
      const to = graph.adjacency[from].find((to) => Math.abs(
        wrappedDistance(graph.nodeX[from], graph.nodeZ[from], army.x, army.z, world.width)
        + wrappedDistance(army.x, army.z, graph.nodeX[to], graph.nodeZ[to], world.width)
        - wrappedDistance(graph.nodeX[from], graph.nodeZ[from], graph.nodeX[to], graph.nodeZ[to], world.width)) < 0.1);
      if (to === undefined) throw new Error('Army is outside its movement edge.');
      const edgeId = edgeIdBetween(graph, from, to);
      army.edge = { from, to, edgeId,
        distanceAlongEdge: edgeDistanceAtPoint(graph, edgeId, from, army.x, army.z) };
    }
    if (army.edge) {
      const edgeId = army.edge.edgeId ?? edgeIdBetween(graph, army.edge.from, army.edge.to);
      if (!nodeExists(army.edge.from) || army.edge.from !== army.graphNodeId
        || edgeId < 0 || !graph.adjacency[army.edge.from]?.includes(army.edge.to)
        || !onEdge(army, army.edge.from, army.edge.to)) throw new Error('Invalid occupied movement edge.');
      army.edge.edgeId = edgeId;
      army.edge.distanceAlongEdge ??= edgeDistanceAtPoint(
        graph, edgeId, army.edge.from, army.x, army.z,
      );
      if (army.edge.distanceAlongEdge < 0
        || army.edge.distanceAlongEdge > graph.edges[edgeId].length + 1e-6) {
        throw new Error('Invalid occupied movement edge progress.');
      }
      // edge position is authoritative; world coordinates are its derived cache
      const derived = edgePositionFrom(graph, edgeId, army.edge.from, army.edge.distanceAlongEdge);
      army.x = derived.x; army.z = derived.z;
    }
    for (const order of [army.order, army.suspendedOrder]) if (order) {
      if (order.edgeProgress < 0 || order.path.some((id) => !nodeExists(id))) throw new Error('Invalid order node.');
      let previous = army.graphNodeId;
      for (let index = 0; index < order.path.length; index += 1) {
        const next = order.path[index];
        const physical = army.edge && index === 0
          ? (next === army.edge.from || next === army.edge.to)
          : graph.adjacency[previous]?.includes(next) || graph.seaAdjacency[previous]?.includes(next);
        if (!physical) throw new Error('Order leaves the movement graph.');
        previous = next;
      }
    }
    for (const frontId of army.battleFrontIds ?? []) {
      const front = state.battleFronts[frontId];
      if (!front || ![...front.sideA.armyIds, ...front.sideB.armyIds].includes(army.id)) throw new Error('Army/front membership mismatch.');
    }
  }
  const queueIds = new Set<string>();
  for (const queues of [state.productionQueues, state.constructionQueues]) {
    for (const [provinceIdText, queue] of Object.entries(queues)) {
      const provinceId = Number(provinceIdText);
      if (!provinceIds.has(provinceId) || !queue.length) throw new Error('Invalid queue province.');
      for (const order of queue) {
        const progress = order.progressWork ?? order.progressHours ?? -1;
        const total = order.totalWork ?? order.totalHours ?? -1;
        if (!state.countries[order.ownerCountryId] || state.provinceOwners[provinceId] !== order.ownerCountryId
          || progress < 0 || progress > total || total <= 0 || queueIds.has(order.id)) {
          throw new Error('Invalid production queue.');
        }
        queueIds.add(order.id);
      }
    }
  }
  for (const provinceIdText of Object.keys(state.provinceBuildings)) {
    if (!provinceIds.has(Number(provinceIdText))) throw new Error('Invalid building province.');
  }
  for (const [provinceIdText, economy] of Object.entries(state.provinceEconomies ?? {})) {
    if (!provinceIds.has(Number(provinceIdText)) || economy.productionCapacity !== 1 || economy.constructionCapacity !== 1) {
      throw new Error('Invalid province economy.');
    }
    for (const value of Object.values(economy.resourcePotential)) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid resource potential.');
    }
    for (const tier of Object.values(economy.resourceBuildings)) {
      if (!Number.isInteger(tier) || tier < 0 || tier > 5) throw new Error('Invalid resource building tier.');
    }
  }
  for (const [provinceIdText, rally] of Object.entries(state.rallyPoints)) {
    const provinceId = Number(provinceIdText);
    if (!provinceIds.has(provinceId) || !(state.provinceOwners[provinceId] > 0)
      || !state.countries[state.provinceOwners[provinceId]]
      || rally.x < 0 || rally.x >= world.width || rally.z < 0 || rally.z >= world.height
      || world.provinceAt(rally.x, rally.z) < 0) throw new Error('Invalid rally point.');
  }
  for (const battle of Object.values(state.battles)) {
    if (state.battles[battle.id] !== battle || new Set(battle.frontIds).size !== battle.frontIds.length
      || !battle.frontIds.length || battle.frontIds.some((id) => state.battleFronts[id]?.battleId !== battle.id)) throw new Error('Invalid battle fronts.');
  }
  for (const front of Object.values(state.battleFronts)) {
    if (state.battleFronts[front.id] !== front || !nodeExists(front.anchorNodeId)
      || !state.battles[front.battleId]?.frontIds.includes(front.id) || front.sideA.countryId === front.sideB.countryId) {
      throw new Error('Invalid front anchor or battle.');
    }
    if ((front.edgeId === undefined) !== (front.distanceAlongEdge === undefined)) {
      throw new Error('Incomplete front road position.');
    }
    if (front.edgeId !== undefined && front.distanceAlongEdge !== undefined) {
      const edge = graph.edges[front.edgeId];
      if (!edge || front.distanceAlongEdge < 0 || front.distanceAlongEdge > edge.length + 1e-6) {
        throw new Error('Invalid front road position.');
      }
      const point = edgePosition(graph, front.edgeId, front.distanceAlongEdge);
      if (wrappedDistance(point.x, point.z, front.x, front.z, world.width) > 0.1) {
        throw new Error('Front is outside its road position.');
      }
    }
    const membership = new Set<string>();
    for (const side of [front.sideA, front.sideB]) {
      if (!state.countries[side.countryId] || !nodeExists(side.directionNodeId)
        || !side.armyIds.length || new Set(side.armyIds).size !== side.armyIds.length
        || Object.keys(side.entryMaxHpByArmy).some((id) => !side.armyIds.includes(id))) throw new Error('Invalid battle side.');
      for (const armyId of side.armyIds) {
        if (membership.has(armyId) || !(side.entryMaxHpByArmy[armyId] > 0)
          || state.armies[armyId]?.ownerCountryId !== side.countryId || !state.armies[armyId].battleFrontIds?.includes(front.id)) {
          throw new Error('Front/army membership mismatch.');
        }
        membership.add(armyId);
      }
    }
  }
  for (const [nodeId, node] of Object.entries(state.resourceNodes)) {
    if (Number(nodeId) !== node.id) throw new Error('Resource key mismatch.');
    // Match the tolerance bootstrapResources() used to assign provinceId in the
    // first place (resolveProvince nudges a coastline/void texel to the
    // nearest land province within a few rings) — a direct-only lookup here
    // would reject nodes that were always legitimately placed this way,
    // failing every restore of a freshly created game.
    if (!provinceIds.has(node.provinceId) || !countryExists(node.controllerCountryId)
      || node.remaining > node.initialAmount || resolveProvince(world, node.x, node.z) !== node.provinceId
      || (node.accessNodeId !== -1 && !nodeExists(node.accessNodeId))) throw new Error('Invalid resource node.');
    if (node.extractorArmyId && state.armies[node.extractorArmyId]?.extractingNodeId !== node.id) {
      node.extractorArmyId = null; node.status = node.remaining > 0 ? 'idle' : 'exhausted';
    }
  }
  for (const army of Object.values(state.armies)) if (army.extractingNodeId !== null) {
    const node = state.resourceNodes[army.extractingNodeId];
    if (!node || node.extractorArmyId !== army.id || army.status !== 'extracting') throw new Error('Invalid extraction link.');
  }
  for (const [key] of Object.entries(state.relations)) {
    const match = /^(\d+):(\d+)$/.exec(key);
    if (!match || Number(match[1]) >= Number(match[2]) || !state.countries[Number(match[1])] || !state.countries[Number(match[2])]) {
      throw new Error('Invalid diplomatic relation.');
    }
  }
  for (const [provinceIdText, until] of Object.entries(state.provinceDevastation ?? {})) {
    if (!provinceIds.has(Number(provinceIdText)) || !Number.isFinite(until) || until < 0) {
      throw new Error('Invalid province devastation.');
    }
  }
  for (const [messageId, message] of Object.entries(state.diplomacyMessages ?? {})) {
    if (message.id !== messageId || !state.countries[message.fromCountryId]
      || !state.countries[message.toCountryId] || message.fromCountryId === message.toCountryId) {
      throw new Error('Invalid diplomacy message.');
    }
  }
  for (const [proposalId, proposal] of Object.entries(state.diplomacyProposals ?? {})) {
    if (proposal.id !== proposalId || !state.countries[proposal.fromCountryId]
      || !state.countries[proposal.toCountryId] || proposal.fromCountryId === proposal.toCountryId
      || (proposal.resolvedAtTick !== undefined && proposal.resolvedAtTick < proposal.createdAtTick)) {
      throw new Error('Invalid diplomacy proposal.');
    }
  }
  const maxSuffix = (ids: Iterable<string>, prefix: string): number => Math.max(0, ...[...ids].map((value) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(value); return match ? Number(match[1]) : 0;
  }));
  if (state.nextArmyId <= maxSuffix(Object.keys(state.armies), 'army')
    || state.nextBattleId <= maxSuffix(Object.keys(state.battles), 'battle')
    || (state.nextFrontId ?? 0) <= maxSuffix(Object.keys(state.battleFronts), 'front')
    || state.nextOrderId <= maxSuffix(queueIds, '(?:ord|bld)')
    || (state.nextDiplomacyId ?? 0) <= maxSuffix([
      ...Object.keys(state.diplomacyMessages ?? {}), ...Object.keys(state.diplomacyProposals ?? {}),
    ], '(?:msg|proposal)') || state.nextEventId < 1) {
    throw new Error('Invalid monotonic identifier counter.');
  }
}
