import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  ['Walking', 'Saluting_Soldier_biped_Animation_Walking_withSkin.glb'],
  ['Injured_Walk', 'Saluting_Soldier_biped_Animation_Injured_Walk_withSkin.glb'],
  ['Injured_Walk_Backward', 'Saluting_Soldier_biped_Animation_Injured_Walk_Backward_withSkin.glb'],
];
const output = resolve(root, 'public/models/infantry.glb');

function readGlb(file) {
  const bytes = readFileSync(resolve(root, file));
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`${file} is not a glTF 2.0 binary`);
  }
  let json;
  let binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) binary = Buffer.from(chunk);
    offset += 8 + length;
  }
  if (!json || !binary) throw new Error(`${file} is missing its JSON or BIN chunk`);
  return { file, json, binary };
}

function pad4(bytes, fill = 0) {
  const padding = (4 - bytes.length % 4) % 4;
  return padding ? Buffer.concat([bytes, Buffer.alloc(padding, fill)]) : bytes;
}

const loaded = sources.map(([clip, file]) => ({ clip, ...readGlb(file) }));
const base = loaded[0];
const baseNodeNames = base.json.nodes.map((node) => node.name ?? '');
const baseJointNames = base.json.skins[0].joints.map((node) => baseNodeNames[node]);

for (const source of loaded) {
  const nodeNames = source.json.nodes.map((node) => node.name ?? '');
  const jointNames = source.json.skins[0].joints.map((node) => nodeNames[node]);
  if (jointNames.join('\0') !== baseJointNames.join('\0')) {
    throw new Error(`${source.file} does not use the same skeleton as ${base.file}`);
  }
  if (!source.json.animations?.some((animation) => animation.name === source.clip)) {
    throw new Error(`${source.file} does not contain animation ${source.clip}`);
  }
}

const json = structuredClone(base.json);
const binaryParts = [base.binary];
let binaryLength = base.binary.length;
json.animations = [json.animations.find((animation) => animation.name === sources[0][0])];

function appendAccessor(source, accessorIndex) {
  const accessor = source.json.accessors[accessorIndex];
  const view = source.json.bufferViews[accessor.bufferView];
  if (view.byteStride) throw new Error(`Interleaved animation data is not supported in ${source.file}`);
  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  const byteLength = accessor.count * componentBytes * components;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const aligned = (binaryLength + 3) & ~3;
  if (aligned > binaryLength) binaryParts.push(Buffer.alloc(aligned - binaryLength));
  binaryParts.push(source.binary.subarray(start, start + byteLength));
  binaryLength = aligned + byteLength;
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength });
  const next = structuredClone(accessor);
  next.bufferView = bufferView;
  delete next.byteOffset;
  json.accessors.push(next);
  return json.accessors.length - 1;
}

for (const source of loaded.slice(1)) {
  const animation = source.json.animations.find((candidate) => candidate.name === source.clip);
  const accessorMap = new Map();
  const mapAccessor = (index) => {
    if (!accessorMap.has(index)) accessorMap.set(index, appendAccessor(source, index));
    return accessorMap.get(index);
  };
  const nodeNames = source.json.nodes.map((node) => node.name ?? '');
  const nodeMap = new Map(baseNodeNames.map((name, index) => [name, index]));
  json.animations.push({
    name: source.clip,
    samplers: animation.samplers.map((sampler) => ({
      ...sampler,
      input: mapAccessor(sampler.input),
      output: mapAccessor(sampler.output),
    })),
    channels: animation.channels.map((channel) => ({
      ...channel,
      target: { ...channel.target, node: nodeMap.get(nodeNames[channel.target.node]) },
    })),
  });
}

const binary = pad4(Buffer.concat(binaryParts));
json.buffers[0].byteLength = binary.length;
const jsonChunk = pad4(Buffer.from(JSON.stringify(json)), 0x20);
const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]));
console.log(`Built ${output} (${(totalLength / 1024 / 1024).toFixed(2)} MiB; ${json.animations.map((a) => a.name).join(', ')})`);
