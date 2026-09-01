import { FIELD_HEIGHT, FIELD_WIDTH, WORLD_HEIGHT, WORLD_WIDTH } from './config.mjs';
import { clamp, wrap } from './raster.mjs';
import { sampleHeight } from '../infrastructure/common.mjs';

export function buildBorders(borderData, heights) {
  const records = [];
  for (const segment of borderData.segments) {
    const neighbor = segment.neighbor_province_id;
    if (neighbor !== null && segment.province_id > neighbor) continue;
    for (let index = 0; index + 1 < segment.coordinates.length; index += 1) {
      const [x1, y1] = segment.coordinates[index];
      const [x2, y2] = segment.coordinates[index + 1];
      const height1 = sampleHeight(heights, FIELD_WIDTH, FIELD_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, x1, y1);
      const height2 = sampleHeight(heights, FIELD_WIDTH, FIELD_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, x2, y2);
      records.push(x1, y1, x2, y2, segment.province_id + 1, neighbor === null ? 0 : neighbor + 1, height1 + 1, height2);
    }
  }
  return new Float32Array(records);
}

export function chunkLineRecords(source) {
  const stride = 8;
  const chunksX = 32;
  const chunksY = 16;
  const buckets = Array.from({ length: chunksX * chunksY }, () => []);
  for (let offset = 0; offset < source.length; offset += stride) {
    const x1 = source[offset];
    let x2 = source[offset + 2];
    if (x2 - x1 > WORLD_WIDTH * 0.5) x2 -= WORLD_WIDTH;
    else if (x2 - x1 < -WORLD_WIDTH * 0.5) x2 += WORLD_WIDTH;
    const centerX = wrap((x1 + x2) * 0.5, WORLD_WIDTH);
    const centerY = clamp((source[offset + 1] + source[offset + 3]) * 0.5, 0, WORLD_HEIGHT - 0.001);
    const chunkX = Math.min(chunksX - 1, Math.floor(centerX / WORLD_WIDTH * chunksX));
    const chunkY = Math.min(chunksY - 1, Math.floor(centerY / WORLD_HEIGHT * chunksY));
    const bucket = buckets[chunkY * chunksX + chunkX];
    for (let component = 0; component < stride; component += 1) bucket.push(source[offset + component]);
  }
  const data = new Float32Array(source.length);
  const ranges = [];
  let firstInstance = 0;
  let cursor = 0;
  for (const bucket of buckets) {
    data.set(bucket, cursor);
    const instanceCount = bucket.length / stride;
    ranges.push({ firstInstance, instanceCount });
    firstInstance += instanceCount;
    cursor += bucket.length;
  }
  return { data, chunksX, chunksY, ranges };
}

// `suppressedLandIndices` is a Set of indices into `connectionData.segments`
// whose land corridor leaves the coastline (see `auditLandConnections`). The
// `medium` byte at offset 4 is left untouched so the runtime graph builder
// registers the identical node sequence; the audit result rides in offset 5,
// which `buildLandGraph` reads to skip linking that edge.
export function buildConnections(connectionData, suppressedLandIndices = new Set()) {
  const records = [];
  connectionData.segments.forEach((edge, index) => {
    const land = edge.medium === 'land' ? 1 : 0;
    const suppressed = land && suppressedLandIndices.has(index) ? 1 : 0;
    records.push(edge.x1, edge.y1, edge.x2, edge.y2, land, suppressed, 0, 0);
  });
  return new Float32Array(records);
}

export function chunkInstanceRecords(source, groupForRecord = () => 0, groupCount = 1) {
  const stride = 8;
  const chunksX = 32;
  const chunksY = 16;
  const buckets = Array.from({ length: chunksX * chunksY }, () =>
    Array.from({ length: groupCount }, () => []));
  for (let offset = 0; offset < source.length; offset += stride) {
    const chunkX = clamp(Math.floor(source[offset] / WORLD_WIDTH * chunksX), 0, chunksX - 1);
    const chunkY = clamp(Math.floor(source[offset + 1] / WORLD_HEIGHT * chunksY), 0, chunksY - 1);
    const group = clamp(groupForRecord(source, offset), 0, groupCount - 1);
    buckets[chunkY * chunksX + chunkX][group].push(...source.subarray(offset, offset + stride));
  }
  const records = [];
  const ranges = [];
  let firstInstance = 0;
  for (const chunkGroups of buckets) {
    const chunkFirst = firstInstance;
    const groups = [];
    for (const groupRecords of chunkGroups) {
      const instanceCount = groupRecords.length / stride;
      groups.push({ firstInstance, instanceCount });
      records.push(...groupRecords);
      firstInstance += instanceCount;
    }
    ranges.push({ firstInstance: chunkFirst, instanceCount: firstInstance - chunkFirst, groups });
  }
  return { data: new Float32Array(records), ranges };
}
