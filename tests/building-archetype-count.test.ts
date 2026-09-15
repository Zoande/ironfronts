import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The number of building archetypes must agree in three unrelated places:
 * how many meshes the renderer allocates (src/rendering/renderer.ts), how many
 * archetype bins scripts/build-world.mjs's chunker groups building instances
 * into, and how many branches src/rendering/scene-meshes.ts actually implements. A
 * mismatch does not error — chunk-visibility.ts's buildPropVisibility clamps
 * `Math.min(group, groupMeshes.length - 1)`, so an under-sized renderer array
 * silently redraws a higher archetype's buildings using a lower archetype's
 * mesh (e.g. all the new archetypes drawn as the landmark) while the shader
 * still reads the real (higher) archetype id from the instance data, hiding
 * whichever materials that mesh happens to have. This is a cheap, GPU-free
 * regression test against exactly that mismatch.
 */
const renderer = readFileSync(path.join(process.cwd(), 'src/rendering/renderer.ts'), 'utf8');
const buildWorld = readFileSync(path.join(process.cwd(), 'scripts/build-world.mjs'), 'utf8');
const sceneMeshes = readFileSync(path.join(process.cwd(), 'src/rendering/scene-meshes.ts'), 'utf8');

describe('building archetype count agrees across renderer, world-build chunker, and mesh generator', () => {
  it('renderer buildingMeshes length matches build-world.mjs\'s chunker groupCount for buildings', () => {
    const rendererMatch = renderer.match(/buildingMeshes = Array\.from\(\{ length: (\d+) \}/);
    const chunkerMatch = buildWorld.match(/chunkInstanceRecords\(generatedInstances\.buildings,[\s\S]*?,\s*(\d+)\)/);
    expect(rendererMatch, 'could not find buildingMeshes allocation in renderer.ts').not.toBeNull();
    expect(chunkerMatch, 'could not find the buildings chunker call in build-world.mjs').not.toBeNull();
    expect(Number(rendererMatch![1])).toBe(Number(chunkerMatch![1]));
  });

  it('scene-meshes.ts implements exactly that many archetype branches (0..N-1)', () => {
    const rendererMatch = renderer.match(/buildingMeshes = Array\.from\(\{ length: (\d+) \}/)!;
    const archetypeCount = Number(rendererMatch[1]);
    const fnStart = sceneMeshes.indexOf('function createBuildingArchetypeMesh');
    const fnBody = sceneMeshes.slice(fnStart, sceneMeshes.indexOf('\n}', fnStart));
    for (let archetype = 0; archetype < archetypeCount - 1; archetype += 1) {
      expect(fnBody, `missing an explicit branch for archetype ${archetype}`).toContain(`archetype === ${archetype}`);
    }
    // The last archetype must be the final catch-all `else` branch, not an
    // explicit check — otherwise it would fall through undetected.
    expect(fnBody, `archetype ${archetypeCount - 1} should be the final catch-all branch, not an explicit check`)
      .not.toContain(`archetype === ${archetypeCount - 1}`);
  });
});
