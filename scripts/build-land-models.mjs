import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** BLENDER_PATH can select another installation; no Python packages are needed. */
export function buildLandModels(families = []) {
  const blender = process.env.BLENDER_PATH ?? [
    'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
  ].find(existsSync) ?? 'blender';
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const [script,args] of [
    ['build_land_armies.py',families], ['build_land_effects.py',[]],
  ]) {
    const result=spawnSync(blender,['--background','--threads','4','--python',path.join(root,'scripts/blender',script),'--',...args],
      {cwd:root,stdio:'inherit',windowsHide:true});
    if(result.error)throw result.error;
    if(result.status!==0)throw new Error(`${script} failed (${result.status})`);
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildLandModels(process.argv.slice(2));
