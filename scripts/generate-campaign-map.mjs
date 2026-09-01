/** Generate the lightweight country-id raster used by the campaign picker. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = path.join(ROOT, 'public', 'world');
const OUTPUT = path.join(ROOT, 'public', 'menu', 'campaign-country-ids.u16');
export const CAMPAIGN_MAP_WIDTH = 1_024;

export async function generateCampaignMap() {
  const [manifestText, provinceBuffer, ownerBuffer] = await Promise.all([
    readFile(path.join(WORLD, 'world.json'), 'utf8'),
    readFile(path.join(WORLD, 'province-ids.u16')),
    readFile(path.join(WORLD, 'province-owners.u32')),
  ]);
  const manifest = JSON.parse(manifestText);
  const sourceWidth = manifest.fields.provinceIds.width;
  const sourceHeight = manifest.fields.provinceIds.height;
  const height = Math.round(CAMPAIGN_MAP_WIDTH * sourceHeight / sourceWidth);
  const provinces = new Uint16Array(
    provinceBuffer.buffer, provinceBuffer.byteOffset, provinceBuffer.byteLength / Uint16Array.BYTES_PER_ELEMENT,
  );
  const owners = new Uint32Array(
    ownerBuffer.buffer, ownerBuffer.byteOffset, ownerBuffer.byteLength / Uint32Array.BYTES_PER_ELEMENT,
  );
  const countries = new Uint16Array(CAMPAIGN_MAP_WIDTH * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height));
    for (let x = 0; x < CAMPAIGN_MAP_WIDTH; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / CAMPAIGN_MAP_WIDTH));
      countries[y * CAMPAIGN_MAP_WIDTH + x] = owners[provinces[sourceY * sourceWidth + sourceX]] ?? 0;
    }
  }
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, new Uint8Array(countries.buffer));
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} — ${CAMPAIGN_MAP_WIDTH}x${height}.`);
  return { width: CAMPAIGN_MAP_WIDTH, height };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateCampaignMap();
}
