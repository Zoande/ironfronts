import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * src/shaders/props.ts's propFragment hides a building's roof/detail parts
 * unless the instance's own baked archetype matches which archetype that
 * material index is reserved for — material 1 (gable) is shared by several
 * archetypes, but materials 2/3/4/5 (porch/tower/hip roof/flat roof) are each
 * hardcoded to exactly one archetype. Using material 4 (hip roof) for an
 * archetype other than 1, for example, silently renders that roof invisible
 * (opacity forced to 0) rather than throwing — the kind of mistake this
 * session nearly shipped while widening the landmark archetype. This is a
 * cheap, GPU-free regression test against exactly that mistake: it doesn't
 * exercise WebGPU, just cross-checks the two source files' text.
 */
const sceneMeshes = readFileSync(path.join(process.cwd(), 'src/rendering/scene-meshes.ts'), 'utf8');
const propsShader = readFileSync(path.join(process.cwd(), 'src/shaders/props.ts'), 'utf8');

// Archetype 7 is the final catch-all `else` branch (not an explicit
// `archetype === 7` check) — update this if createBuildingArchetypeMesh ever
// gains an archetype 8.
const LAST_ARCHETYPE = 7;
const ALL_ARCHETYPES = [0, 1, 2, 3, 4, 5, 6, 7];

function archetypeBranch(archetype: number): string {
  // Isolate createBuildingArchetypeMesh's own body, then the branch for this
  // archetype, up to the next "} else" or the function's closing brace.
  const fnStart = sceneMeshes.indexOf('function createBuildingArchetypeMesh');
  const fnBody = sceneMeshes.slice(fnStart, sceneMeshes.indexOf('\n}', fnStart));
  const marker = archetype === LAST_ARCHETYPE ? '} else {' : `archetype === ${archetype}`;
  const start = fnBody.indexOf(marker);
  expect(start, `no branch found for archetype ${archetype}`).toBeGreaterThan(-1);
  const nextElse = fnBody.indexOf('} else', start + marker.length);
  return fnBody.slice(start, nextElse === -1 ? undefined : nextElse);
}

describe('building archetype material indices match the shader\'s per-archetype gating', () => {
  it('archetype 1 is the only one allowed to use material 4 (hip roof)', () => {
    expect(propsShader).toContain('archetype != 1u');
    for (const archetype of ALL_ARCHETYPES) {
      const branch = archetypeBranch(archetype);
      const usesHipRoof = /addHipRoof\([^)]*\)/.test(branch);
      if (archetype === 1) expect(usesHipRoof).toBe(true);
      else expect(usesHipRoof, `archetype ${archetype} must not use addHipRoof (material 4) — the shader hides it`).toBe(false);
    }
  });

  it('archetype 2 is the only one allowed to use material 5 (flat roof)', () => {
    expect(propsShader).toContain('archetype != 2u');
    for (const archetype of ALL_ARCHETYPES) {
      const branch = archetypeBranch(archetype);
      const usesFlatRoofMaterial = /,\s*5,\s*5\)/.test(branch);
      if (archetype === 2) expect(usesFlatRoofMaterial).toBe(true);
      else expect(usesFlatRoofMaterial, `archetype ${archetype} must not use material 5 — the shader hides it outside archetype 2`).toBe(false);
    }
  });

  it('archetype 3 is the only one allowed to use material 2 (porch)', () => {
    expect(propsShader).toContain('archetype != 3u');
    for (const archetype of ALL_ARCHETYPES) {
      const branch = archetypeBranch(archetype);
      const usesPorchMaterial = /,\s*2,\s*2\)/.test(branch);
      if (archetype === 3) expect(usesPorchMaterial).toBe(true);
      else expect(usesPorchMaterial, `archetype ${archetype} must not use material 2 — the shader hides it outside archetype 3`).toBe(false);
    }
  });

  it('archetype 4 is the only one allowed to use material 3 (tower)', () => {
    expect(propsShader).toContain('archetype != 4u');
    for (const archetype of ALL_ARCHETYPES) {
      const branch = archetypeBranch(archetype);
      const usesTowerMaterial = /,\s*3,\s*3\)/.test(branch);
      if (archetype === 4) expect(usesTowerMaterial).toBe(true);
      else expect(usesTowerMaterial, `archetype ${archetype} must not use material 3 — the shader hides it outside archetype 4`).toBe(false);
    }
  });

  it('archetypes 1 and 2 must not use material 1 (gable roof) — the shader hides it for them', () => {
    expect(propsShader).toContain('archetype == 1u || archetype == 2u');
    for (const archetype of [1, 2]) {
      const branch = archetypeBranch(archetype);
      expect(/addGableRoof/.test(branch), `archetype ${archetype} must not use addGableRoof (material 1) — the shader hides it`).toBe(false);
    }
    // 0, 3, 4, and 5 are the archetypes that actually use a gable roof.
    for (const archetype of [0, 3, 4, 5]) {
      expect(/addGableRoof/.test(archetypeBranch(archetype))).toBe(true);
    }
  });

  it('new archetypes 5, 6, and 7 only ever use material 0 (wall) or 1 (roof) — no shader changes were needed for them', () => {
    for (const archetype of [5, 6, 7]) {
      const branch = archetypeBranch(archetype);
      expect(/addHipRoof/.test(branch), `archetype ${archetype} must not use addHipRoof (material 4)`).toBe(false);
      expect(/,\s*5,\s*5\)/.test(branch), `archetype ${archetype} must not use material 5 (flat roof)`).toBe(false);
      expect(/,\s*2,\s*2\)/.test(branch), `archetype ${archetype} must not use material 2 (porch)`).toBe(false);
      expect(/,\s*3,\s*3\)/.test(branch), `archetype ${archetype} must not use material 3 (tower)`).toBe(false);
    }
  });
});
