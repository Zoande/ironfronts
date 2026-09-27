const RIVER_NAMES = new Set([
  'Colorado River', 'Congo River', 'Donau', 'Ganga River', 'Hooghly River', 'Indus River',
  'Krishna River', 'Lena', 'Meghna River', 'Mekong River', 'Mississippi River', 'Nile', 'Ob River',
  'Padma River', 'Rhein', 'Rio Amazonas', 'Snake River', 'St. Lawrence', 'Tocantina River',
  'Volga', 'Yangtze River', 'Yellow River', 'Yukon River', 'Yunisei',
]);

const CANAL_NAMES = new Set(['Kiel Canal', 'Suez Channel']);

export function nodeName(node) {
  return node?.location_name ?? '';
}

export function isRiver(node) {
  return node?.kind === 'sea_point' && (RIVER_NAMES.has(nodeName(node))
    || process.env.MAP_KIND === 'europe' && / River$/.test(nodeName(node)));
}

export function isCanal(node) {
  return node?.kind === 'sea_point' && CANAL_NAMES.has(nodeName(node));
}

function selectSuezEdges(suez, candidates, nodes) {
  const gulf = candidates.find((edge) => nodeName(nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a]) === 'Gulf of Suez');
  if (!gulf) return [];
  const gulfNode = nodes[gulf.node_a === suez.node_id ? gulf.node_b : gulf.node_a];
  const gx = gulfNode.x - suez.x;
  const gz = gulfNode.y - suez.y;
  const gulfLength = Math.max(0.001, Math.hypot(gx, gz));
  const mediterranean = candidates
    .filter((edge) => nodeName(nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a]) === 'Mediterranean Sea')
    .map((edge) => {
      const endpoint = nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a];
      const dx = endpoint.x - suez.x;
      const dz = endpoint.y - suez.y;
      return { edge, alignment: (dx * gx + dz * gz) / (Math.max(0.001, Math.hypot(dx, dz)) * gulfLength) };
    })
    .sort((a, b) => a.alignment - b.alignment)[0]?.edge;
  return mediterranean ? [mediterranean, gulf] : [gulf];
}

export function collectWaterwayEdges(networkData, connectionData) {
  const nodes = networkData.nodes;
  const byNode = Array.from({ length: nodes.length }, () => []);
  for (const edge of connectionData.segments) {
    byNode[edge.node_a]?.push(edge);
    byNode[edge.node_b]?.push(edge);
  }

  const selected = new Map();
  const add = (edge, kind) => selected.set(edge.segment_id, { ...edge, kind });
  for (const edge of connectionData.segments) {
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    if (!a || !b || edge.medium !== 'sea') continue;
    if (isRiver(a) && isRiver(b)) add(edge, 0);
    else if ((isRiver(a) && b.kind === 'sea_point') || (isRiver(b) && a.kind === 'sea_point')) add(edge, 0);
    else if (isCanal(a) && isCanal(b)) add(edge, 1);
  }

  for (const node of nodes) {
    if (nodeName(node) === 'Kiel Canal') {
      for (const edge of byNode[node.node_id]) {
        const other = nodes[edge.node_a === node.node_id ? edge.node_b : edge.node_a];
        if (edge.medium === 'sea' && other?.kind === 'sea_point') add(edge, 1);
      }
    }
  }
  const suez = nodes.find((node) => nodeName(node) === 'Suez Channel');
  if (suez) {
    const candidates = byNode[suez.node_id].filter((edge) => {
      const other = nodes[edge.node_a === suez.node_id ? edge.node_b : edge.node_a];
      return edge.medium === 'sea' && other?.kind === 'sea_point';
    });
    for (const edge of selectSuezEdges(suez, candidates, nodes)) add(edge, 1);
  }
  return [...selected.values()].sort((a, b) => a.segment_id - b.segment_id);
}
