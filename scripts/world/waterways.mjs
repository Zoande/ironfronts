import { clamp, sampleHeight, unwrapNear, wrap } from '../infrastructure/common.mjs';
import { collectWaterwayEdges, isCanal, isRiver, nodeName } from './waterway-selection.mjs';

// The terrain grid is intentionally much coarser than roads and waterways.
// Sub-unit sampling keeps the channel mask and terrain-draped surface aligned.
const SAMPLE_SPACING = 0.6;
const OPEN_WATER_HEIGHT = 0.42;
const WATER_SURFACE_LIFT = 0.14;
const MOVEMENT_CROSS_SECTION_SAMPLES = 5;
const NODE_CAP_SEGMENTS = 24;
const MINIMUM_RIVER_HALF_WIDTH = 5.5;
const MINIMUM_CANAL_HALF_WIDTH = 5.0;

function pointId(provinceIds, idWidth, idHeight, worldWidth, worldHeight, x, z) {
  const px = wrap(Math.floor(x / worldWidth * idWidth), idWidth);
  const pz = clamp(Math.floor(z / worldHeight * idHeight), 0, idHeight - 1);
  return provinceIds[pz * idWidth + px];
}

function drapedHeight(context, x, z, lift = WATER_SURFACE_LIFT) {
  const terrain = sampleHeight(context.heights, context.heightWidth, context.heightHeight,
    context.worldWidth, context.worldHeight, x, z);
  return terrain > 0.04 ? terrain + lift : OPEN_WATER_HEIGHT;
}

function scanBank({ provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight, worldWidth, worldHeight }, x, z, nx, nz, sign) {
  for (let distance = 0.7; distance <= 28; distance += 0.7) {
    const sx = x + nx * distance * sign;
    const sz = z + nz * distance * sign;
    if (pointId(provinceIds, idWidth, idHeight, worldWidth, worldHeight, sx, sz) === 0) continue;
    const inlandX = sx + nx * sign * 1.1;
    const inlandZ = sz + nz * sign * 1.1;
    return {
      distance,
      height: sampleHeight(heights, heightWidth, heightHeight, worldWidth, worldHeight, inlandX, inlandZ),
    };
  }
  return null;
}

function crossSection(context, x, z, dx, dz, kind) {
  const length = Math.max(0.001, Math.hypot(dx, dz));
  const nx = -dz / length;
  const nz = dx / length;
  const leftBank = scanBank(context, x, z, nx, nz, 1);
  const rightBank = scanBank(context, x, z, nx, nz, -1);
  // A river narrower than roughly two high-resolution mask texels can vanish
  // under oblique projection. Keep a strategy-readable minimum while bank
  // scans still allow major channels to widen naturally.
  const minimum = kind === 1 ? MINIMUM_CANAL_HALF_WIDTH : MINIMUM_RIVER_HALF_WIDTH;
  const maximum = kind === 1 ? 7.5 : 10.5;
  const left = clamp((leftBank?.distance ?? minimum) + 0.55, minimum, maximum);
  const right = clamp((rightBank?.distance ?? minimum) + 0.55, minimum, maximum);
  const waterHeight = drapedHeight(context, x, z);
  return { nx, nz, left, right, waterHeight, banked: Boolean(leftBank && rightBank) };
}

function makeNodeSurface(context, node, incidentEdges, nodes, kind) {
  if (!isRiver(node) && !isCanal(node)) return { y: OPEN_WATER_HEIGHT, radius: kind === 1 ? 4.2 : 3.5 };
  const sections = [];
  for (const edge of incidentEdges) {
    const other = nodes[edge.node_a === node.node_id ? edge.node_b : edge.node_a];
    const otherX = unwrapNear(other.x, node.x, context.worldWidth);
    sections.push(crossSection(context, node.x, node.y, otherX - node.x, other.y - node.y, kind));
  }
  const y = drapedHeight(context, node.x, node.y);
  const radius = sections.length ? Math.max(...sections.flatMap((section) => [section.left, section.right])) : kind === 1 ? 3.2 : 2.2;
  return { y, radius };
}

function markCircle(field, width, height, worldWidth, worldHeight, x, z, radius, conservative = false) {
  const cx = x / worldWidth * width;
  const cz = z / worldHeight * height;
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const padding = conservative ? Math.hypot(pixelWidth, pixelHeight) * 0.5 : 0;
  const effectiveRadius = radius + padding;
  const rx = Math.max(1, Math.ceil(effectiveRadius / pixelWidth));
  const rz = Math.max(1, Math.ceil(effectiveRadius / pixelHeight));
  for (let oz = -rz; oz <= rz; oz += 1) {
    const py = Math.floor(cz + oz);
    if (py < 0 || py >= height) continue;
    for (let ox = -rx; ox <= rx; ox += 1) {
      const px = wrap(Math.floor(cx + ox), width);
      let deltaPixelsX = px + 0.5 - cx;
      if (deltaPixelsX > width * 0.5) deltaPixelsX -= width;
      if (deltaPixelsX < -width * 0.5) deltaPixelsX += width;
      const dx = deltaPixelsX * pixelWidth;
      const dz = (py + 0.5 - cz) * pixelHeight;
      if (dx * dx + dz * dz > effectiveRadius * effectiveRadius) continue;
      field[py * width + px] = 255;
    }
  }
}

function markCorridor(field, width, height, worldWidth, worldHeight, x, z, section, extraWidth = 0) {
  const cx = x / worldWidth * width;
  const cz = z / worldHeight * height;
  const pixelWidth = worldWidth / width;
  const pixelHeight = worldHeight / height;
  const alongPadding = Math.hypot(pixelWidth, pixelHeight) * 0.55;
  const radius = Math.max(section.left, section.right) + extraWidth + alongPadding;
  const rx = Math.max(1, Math.ceil(radius / pixelWidth));
  const rz = Math.max(1, Math.ceil(radius / pixelHeight));
  const tx = -section.nz;
  const tz = section.nx;
  for (let oz = -rz; oz <= rz; oz += 1) {
    const py = Math.floor(cz + oz);
    if (py < 0 || py >= height) continue;
    for (let ox = -rx; ox <= rx; ox += 1) {
      const px = wrap(Math.floor(cx + ox), width);
      let deltaPixelsX = px + 0.5 - cx;
      if (deltaPixelsX > width * 0.5) deltaPixelsX -= width;
      if (deltaPixelsX < -width * 0.5) deltaPixelsX += width;
      const dx = deltaPixelsX * pixelWidth;
      const dz = (py + 0.5 - cz) * pixelHeight;
      const lateral = dx * section.nx + dz * section.nz;
      const longitudinal = dx * tx + dz * tz;
      if (Math.abs(longitudinal) > SAMPLE_SPACING * 0.6 + alongPadding) continue;
      if (lateral > section.left + extraWidth || lateral < -section.right - extraWidth) continue;
      field[py * width + px] = 255;
    }
  }
}

function sortIndicesByChunk(indices, batches, chunksX, chunksY) {
  const byChunk = Array.from({ length: chunksX * chunksY }, () => []);
  for (const batch of batches) byChunk[batch.chunk].push(batch);
  const sorted = new Uint32Array(indices.length);
  const ranges = [];
  let cursor = 0;
  for (const chunk of byChunk) {
    const firstIndex = cursor;
    for (const batch of chunk) {
      for (let index = batch.firstIndex; index < batch.firstIndex + batch.indexCount; index += 1) sorted[cursor++] = indices[index];
    }
    ranges.push({ firstIndex, indexCount: cursor - firstIndex });
  }
  return { indices: sorted, ranges };
}

export function buildWaterways({
  networkData, connectionData, provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight,
  worldWidth, worldHeight, chunksX = 32, chunksY = 16,
}) {
  const started = performance.now();
  const context = { provinceIds, idWidth, idHeight, heights, heightWidth, heightHeight, worldWidth, worldHeight };
  const nodes = networkData.nodes;
  const edges = collectWaterwayEdges(networkData, connectionData);
  const incident = new Map();
  for (const edge of edges) {
    if (!incident.has(edge.node_a)) incident.set(edge.node_a, []);
    if (!incident.has(edge.node_b)) incident.set(edge.node_b, []);
    incident.get(edge.node_a).push(edge);
    incident.get(edge.node_b).push(edge);
  }
  const nodeSurfaces = new Map();
  for (const [nodeId, nodeEdges] of incident) {
    const kind = nodeEdges.some((edge) => edge.kind === 1) ? 1 : 0;
    nodeSurfaces.set(nodeId, makeNodeSurface(context, nodes[nodeId], nodeEdges, nodes, kind));
  }
  const networkLines = [];
  const systemIds = new Map();
  const systemId = (name) => {
    if (!systemIds.has(name)) systemIds.set(name, systemIds.size + 1);
    return systemIds.get(name);
  };
  for (const edge of edges) {
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    const aSurface = nodeSurfaces.get(edge.node_a);
    const bSurface = nodeSurfaces.get(edge.node_b);
    const named = isRiver(a) || isCanal(a) ? nodeName(a) : nodeName(b);
    networkLines.push(a.x, a.y, b.x, b.y, aSurface.y, bSurface.y, edge.kind, systemId(named));
  }

  const vertices = [];
  const indices = [];
  const batches = [];
  const clearance = new Uint8Array(idWidth * idHeight);
  const mask = new Uint8Array(idWidth * idHeight);
  const chunkFor = (x, z) => clamp(Math.floor(z / worldHeight * chunksY), 0, chunksY - 1) * chunksX
    + clamp(Math.floor(wrap(x, worldWidth) / worldWidth * chunksX), 0, chunksX - 1);
  const addVertex = (position, uv, edgeFactor, kind, flow, speed) => {
    const vertex = vertices.length / 10;
    vertices.push(...position, ...uv, edgeFactor, kind, ...flow, speed);
    return vertex;
  };
  let totalLength = 0;
  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;
  let minimumWidth = Infinity;
  let maximumWidth = -Infinity;

  for (const edge of edges) {
    // Canal passages are already authored as province-zero channels. Let the
    // ocean/lake pass render them with identical water and keep these edges
    // in the diagnostic graph; an explicit ribbon creates offshore caps.
    if (edge.kind === 1) continue;
    const a = nodes[edge.node_a];
    const b = nodes[edge.node_b];
    const bx = unwrapNear(b.x, a.x, worldWidth);
    const dx = bx - a.x;
    const dz = b.y - a.y;
    const length = Math.hypot(dx, dz);
    let segments = Math.max(1, Math.ceil(length / SAMPLE_SPACING));
    const aSurface = nodeSurfaces.get(edge.node_a);
    const bSurface = nodeSurfaces.get(edge.node_b);
    const rings = [];
    const samples = [];
    totalLength += length;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const x = a.x + dx * t;
      const z = a.y + dz * t;
      const section = crossSection(context, x, z, dx, dz, edge.kind);
      samples.push({ x, z, t, section });
    }
    // Source mouth links terminate at broad sea nodes far offshore. Render the
    // authored channel only until its banks open, plus a short submerged
    // overlap, so rivers and canals dissolve into open water without a long
    // rectangular strip across the ocean.
    const aNamed = isRiver(a) || isCanal(a);
    const bNamed = isRiver(b) || isCanal(b);
    const overlapSamples = Math.ceil(12 / SAMPLE_SPACING);
    if (aNamed && !bNamed) {
      let sawBanks = false;
      for (let index = 0; index < samples.length; index += 1) {
        if (samples[index].section.banked) sawBanks = true;
        else if (sawBanks) {
          samples.splice(Math.min(samples.length, index + overlapSamples + 1));
          break;
        }
      }
    } else if (!aNamed && bNamed) {
      let sawBanks = false;
      for (let index = samples.length - 1; index >= 0; index -= 1) {
        if (samples[index].section.banked) sawBanks = true;
        else if (sawBanks) {
          samples.splice(0, Math.max(0, index - overlapSamples));
          break;
        }
      }
    }
    segments = samples.length - 1;
    // Bank scans follow the exact source topology but can change by a texel at
    // a time. Smooth only the width signal; the supplied centerline and all
    // endpoints remain untouched.
    for (let pass = 0; pass < 5; pass += 1) {
      const widths = samples.map((sample) => [sample.section.left, sample.section.right]);
      for (let index = 1; index + 1 < samples.length; index += 1) {
        samples[index].section.left = (widths[index - 1][0] + widths[index][0] * 2 + widths[index + 1][0]) * 0.25;
        samples[index].section.right = (widths[index - 1][1] + widths[index][1] * 2 + widths[index + 1][1]) * 0.25;
      }
    }
    for (let index = 0; index < samples.length; index += 1) {
      const { x, z, t, section } = samples[index];
      const y = drapedHeight(context, x, z);
      const directionLength = Math.max(0.001, Math.hypot(dx, dz));
      const downhillSign = aSurface.y >= bSurface.y ? 1 : -1;
      const flow = [dx / directionLength * downhillSign, dz / directionLength * downhillSign];
      const width = section.left + section.right;
      const gradient = Math.abs(aSurface.y - bSurface.y) / Math.max(1, length);
      const variation = 0.86 + 0.18 * Math.sin(edge.segment_id * 0.731 + t * 13.7)
        + 0.08 * Math.sin(edge.segment_id * 0.193 - t * 31.1);
      const speed = (edge.kind === 1 ? 0.34 : clamp(0.48 + gradient * 14 + 3.5 / width, 0.48, 1.35)) * variation;
      const left = x + section.nx * section.left;
      const leftZ = z + section.nz * section.left;
      const right = x - section.nx * section.right;
      const rightZ = z - section.nz * section.right;
      const across = [
        [left, leftZ, 0, 1, 0.32],
        [(left + x) * 0.5, (leftZ + z) * 0.5, 0.25, 0.48, 0.62],
        [x, z, 0.5, 0, 1],
        [(x + right) * 0.5, (z + rightZ) * 0.5, 0.75, 0.48, 0.62],
        [right, rightZ, 1, 1, 0.32],
      ];
      rings.push(across.map(([sampleX, sampleZ, acrossUv, edgeFactor, speedFactor]) => addVertex(
        [sampleX, drapedHeight(context, sampleX, sampleZ, acrossUv === 0.5 ? WATER_SURFACE_LIFT + 0.015 : WATER_SURFACE_LIFT), sampleZ],
        [length * t / 24, acrossUv], edgeFactor, edge.kind, flow, speed * speedFactor,
      )));
      const openWaterTail = pointId(provinceIds, idWidth, idHeight, worldWidth, worldHeight, x, z) === 0 && !section.banked;
      if (!openWaterTail) {
        markCorridor(clearance, idWidth, idHeight, worldWidth, worldHeight, x, z, section, 2.5);
        // Keep the terrain-removal signal safely inside the explicit ribbon;
        // the render-time filtered contour supplies the remaining overlap.
        markCorridor(mask, idWidth, idHeight, worldWidth, worldHeight, x, z, section, -0.7);
      }
      minimumHeight = Math.min(minimumHeight, y);
      maximumHeight = Math.max(maximumHeight, y);
      minimumWidth = Math.min(minimumWidth, section.left + section.right);
      maximumWidth = Math.max(maximumWidth, section.left + section.right);
    }
    for (let index = 0; index < segments; index += 1) {
      const firstIndex = indices.length;
      const current = rings[index];
      const next = rings[index + 1];
      for (let lane = 0; lane < MOVEMENT_CROSS_SECTION_SAMPLES - 1; lane += 1) {
        indices.push(current[lane], next[lane], next[lane + 1], current[lane], next[lane + 1], current[lane + 1]);
      }
      batches.push({ chunk: chunkFor((samples[index].x + samples[index + 1].x) * 0.5,
        (samples[index].z + samples[index + 1].z) * 0.5), firstIndex, indexCount: 24 });
    }
  }

  // Small static patches close differently oriented strips at sources,
  // confluences, and canal bends without altering the supplied centerlines.
  for (const [nodeId, nodeEdges] of incident) {
    const node = nodes[nodeId];
    if (!isRiver(node) && !isCanal(node)) continue;
    const surface = nodeSurfaces.get(nodeId);
    const kind = nodeEdges.some((edge) => edge.kind === 1) ? 1 : 0;
    if (kind === 1) continue;
    const firstIndex = indices.length;
    const firstEdge = nodeEdges[0];
    const other = nodes[firstEdge.node_a === nodeId ? firstEdge.node_b : firstEdge.node_a];
    const flowLength = Math.max(0.001, Math.hypot(unwrapNear(other.x, node.x, worldWidth) - node.x, other.y - node.y));
    const flow = [(unwrapNear(other.x, node.x, worldWidth) - node.x) / flowLength, (other.y - node.y) / flowLength];
    const center = addVertex([node.x, drapedHeight(context, node.x, node.y, WATER_SURFACE_LIFT + 0.015), node.y],
      [0, 0.5], 0, kind, flow, kind === 1 ? 0.3 : 0.58);
    const ring = [];
    const capSegments = NODE_CAP_SEGMENTS;
    for (let step = 0; step < capSegments; step += 1) {
      const angle = step / capSegments * Math.PI * 2;
      const ringX = node.x + Math.cos(angle) * surface.radius;
      const ringZ = node.y + Math.sin(angle) * surface.radius;
      ring.push(addVertex([ringX, drapedHeight(context, ringX, ringZ), ringZ],
        [0, step / capSegments], 1, kind, flow, kind === 1 ? 0.18 : 0.24));
    }
    for (let step = 0; step < capSegments; step += 1) indices.push(center, ring[step], ring[(step + 1) % capSegments]);
    batches.push({ chunk: chunkFor(node.x, node.y), firstIndex, indexCount: indices.length - firstIndex });
    markCircle(mask, idWidth, idHeight, worldWidth, worldHeight, node.x, node.y, Math.max(0.5, surface.radius - 0.7));
    markCircle(clearance, idWidth, idHeight, worldWidth, worldHeight, node.x, node.y, surface.radius + 2.5, true);
  }

  const sorted = sortIndicesByChunk(indices, batches, chunksX, chunksY);
  const riverNodes = nodes.filter(isRiver);
  const canalNodes = nodes.filter(isCanal);
  const riverEdges = edges.filter((edge) => edge.kind === 0);
  const canalEdges = edges.filter((edge) => edge.kind === 1);
  const mouthEdges = riverEdges.filter((edge) => !isRiver(nodes[edge.node_a]) || !isRiver(nodes[edge.node_b]));
  const riverShowcaseNode = riverNodes.find((node) => nodeName(node) === 'Nile') ?? riverNodes[0];
  const mouthShowcaseEdge = mouthEdges[0];
  const mouthA = mouthShowcaseEdge ? nodes[mouthShowcaseEdge.node_a] : riverShowcaseNode;
  const mouthB = mouthShowcaseEdge ? nodes[mouthShowcaseEdge.node_b] : riverShowcaseNode;
  const kielNode = canalNodes.find((node) => nodeName(node) === 'Kiel Canal');
  const suezNode = canalNodes.find((node) => nodeName(node) === 'Suez Channel');
  const report = {
    source: 'material/movement network sea_point graph',
    animatedSurface: true,
    animation: 'simple-flow-aligned-shimmer',
    terrainTreatment: 'shallow lower-only channel with guarded inner terrain clip and independently draped surface vertices',
    sampleSpacing: SAMPLE_SPACING,
    crossSectionSamples: MOVEMENT_CROSS_SECTION_SAMPLES,
    nodeCapSegments: NODE_CAP_SEGMENTS,
    surfaceLift: WATER_SURFACE_LIFT,
    terrainClipMask: true,
    terrainOverlayMask: true,
    riverSystems: [...new Set(riverNodes.map(nodeName))].sort(),
    riverSourcePoints: riverNodes.length,
    riverSegments: riverEdges.length,
    riverMouthLinks: mouthEdges.length,
    canalSystems: [...new Set(canalNodes.map(nodeName))].sort(),
    canalSourcePoints: canalNodes.length,
    canalSegments: canalEdges.length,
    canalSurface: 'static-water province-zero channel',
    totalLength,
    widthRange: [minimumWidth, maximumWidth],
    minimumRiverWidth: MINIMUM_RIVER_HALF_WIDTH * 2,
    minimumCanalWidth: MINIMUM_CANAL_HALF_WIDTH * 2,
    heightRange: [minimumHeight, maximumHeight],
    buildMilliseconds: performance.now() - started,
  };
  return {
    vertices: new Float32Array(vertices),
    indices: sorted.indices,
    networkLines: new Float32Array(networkLines),
    chunkRanges: sorted.ranges,
    clearance,
    mask,
    report,
    stats: {
      riverSystems: report.riverSystems.length,
      riverSourcePoints: report.riverSourcePoints,
      riverSegments: report.riverSegments,
      riverMouthLinks: report.riverMouthLinks,
      canalSystems: report.canalSystems.length,
      canalSourcePoints: report.canalSourcePoints,
      canalSegments: report.canalSegments,
      waterwayTriangles: sorted.indices.length / 3,
    },
    showcases: {
      river: riverShowcaseNode ? [riverShowcaseNode.x, riverShowcaseNode.y] : [worldWidth / 2, worldHeight / 2],
      riverMouth: mouthA && mouthB ? [(mouthA.x + unwrapNear(mouthB.x, mouthA.x, worldWidth)) * 0.5, (mouthA.y + mouthB.y) * 0.5] : [worldWidth / 2, worldHeight / 2],
      kielCanal: kielNode ? [kielNode.x, kielNode.y] : [worldWidth / 2, worldHeight / 2],
      suezCanal: suezNode ? [suezNode.x, suezNode.y] : [worldWidth / 2, worldHeight / 2],
    },
  };
}
