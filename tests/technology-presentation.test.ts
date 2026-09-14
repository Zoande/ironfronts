import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TECHNOLOGY_HOURS_BY_LEVEL } from '../src/game/technology';
import {
  TECHNOLOGY_BRANCH_PRESENTATION,
  buildTechnologyPanelModel,
  defaultTechnologyInspectionLevel,
  technologyTabAfterKey,
  technologyLevelState,
} from '../src/ui/technology-presentation';
import type { TechnologyBranch, TechnologyView } from '../src/ui/ui-state';

const technologyAssetDirectory = path.join(process.cwd(), 'src/ui/assets/technology');
const branches: readonly TechnologyBranch[] = ['infantry', 'resources', 'resourceBuildings', 'training', 'hybrid', 'armored'];
const technologyView = (
  levels: TechnologyView['levels'],
  slots: TechnologyView['slots'] = [null, null],
  quoteOverrides: Partial<TechnologyView['quotes']> = {},
): TechnologyView => ({
  levels,
  slots,
  quotes: Object.fromEntries(branches.map((branch) => [branch, {
    hours: TECHNOLOGY_HOURS_BY_LEVEL[Math.min(8, levels[branch] + 1)],
    cost: { funds: 250 },
    affordable: true,
    ...quoteOverrides[branch],
  }])) as TechnologyView['quotes'],
  levelQuotes: Object.fromEntries(branches.map((branch) => [branch,
    Array.from({ length: 8 }, (_, index) => ({
      level: index + 1,
      hours: TECHNOLOGY_HOURS_BY_LEVEL[index + 1],
      cost: { funds: 250 },
      affordable: true,
    })),
  ])) as unknown as TechnologyView['levelQuotes'],
});

describe('technology presentation', () => {
  it('classifies every level relative to the current and active project', () => {
    expect(technologyLevelState(3, 2)).toBe('completed');
    expect(technologyLevelState(3, 3)).toBe('current');
    expect(technologyLevelState(3, 4)).toBe('available');
    expect(technologyLevelState(3, 4, 4)).toBe('researching');
    expect(technologyLevelState(3, 5, 4)).toBe('locked');
  });

  it('opens on the next development, or the final dossier at maximum level', () => {
    expect(defaultTechnologyInspectionLevel(1)).toBe(2);
    expect(defaultTechnologyInspectionLevel(7)).toBe(8);
    expect(defaultTechnologyInspectionLevel(8)).toBe(8);
  });

  it('implements the standard horizontal tab-list keyboard order', () => {
    expect(technologyTabAfterKey('infantry', 'ArrowRight')).toBe('resources');
    expect(technologyTabAfterKey('infantry', 'ArrowLeft')).toBe('airforce');
    expect(technologyTabAfterKey('armored', 'ArrowRight')).toBe('navy');
    expect(technologyTabAfterKey('navy', 'ArrowRight')).toBe('airforce');
    expect(technologyTabAfterKey('airforce', 'ArrowRight')).toBe('infantry');
    expect(technologyTabAfterKey('hybrid', 'Home')).toBe('infantry');
    expect(technologyTabAfterKey('resources', 'End')).toBe('airforce');
    expect(technologyTabAfterKey('training', 'Enter')).toBeNull();
  });

  it('provides eight briefings for all six live research branches', () => {
    expect(Object.keys(TECHNOLOGY_BRANCH_PRESENTATION)).toEqual([
      'infantry',
      'resources',
      'resourceBuildings',
      'training',
      'hybrid',
      'armored',
    ]);

    for (const branch of Object.values(TECHNOLOGY_BRANCH_PRESENTATION)) {
      expect(branch.levels).toHaveLength(8);
      expect(branch.levels.every((level) => level.name && level.summary && level.authorization && level.effect)).toBe(true);
      expect(branch.levels.map((level) => level.hours)).toEqual([...TECHNOLOGY_HOURS_BY_LEVEL.slice(1)]);
    }

    expect(TECHNOLOGY_BRANCH_PRESENTATION.resources.levels[7].authorization).toBe('Engineer VIII');
    expect(TECHNOLOGY_BRANCH_PRESENTATION.resourceBuildings.levels[7].authorization).toBe('Tier VIII resource sites');
    expect(TECHNOLOGY_BRANCH_PRESENTATION.hybrid.levels[7].authorization)
      .toBe('Armored Car VIII, Artillery VIII, and Missile Sites');

    expect(TECHNOLOGY_BRANCH_PRESENTATION.infantry.levels[3].effect)
      .toContain('1.48× HP · 1.54× firepower · 1.07× movement');
    expect(TECHNOLOGY_BRANCH_PRESENTATION.resourceBuildings.levels[3].effect)
      .toContain('17/h passive · 11 engineers · 3.25× engineer output');
    expect(TECHNOLOGY_BRANCH_PRESENTATION.training.levels[3].effect)
      .toContain('2.05 work/h');
    expect(TECHNOLOGY_BRANCH_PRESENTATION.hybrid.levels[7].effect)
      .toContain('Missile Site authorization');
  });

  it('assigns distinct artwork to every branch and every technology level', () => {
    const branches = Object.values(TECHNOLOGY_BRANCH_PRESENTATION);
    const backdropUrls = branches.map((branch) => branch.backdropUrl);
    const levelVisualUrls = branches.flatMap((branch) => branch.levels.map((level) => level.visualUrl));

    expect(backdropUrls).toHaveLength(6);
    expect(new Set(backdropUrls).size).toBe(6);
    expect(backdropUrls.every(Boolean)).toBe(true);

    expect(levelVisualUrls).toHaveLength(48);
    expect(new Set(levelVisualUrls).size).toBe(48);
    expect(levelVisualUrls.every(Boolean)).toBe(true);
  });

  it('ships hash-distinct compressed field art without the unused fallback dossier', () => {
    const files = readdirSync(technologyAssetDirectory);
    const levelFiles = files.filter((name) => /^(infantry|resources|resource-buildings|training|hybrid|armored)-[1-8]\.jpg$/.test(name));
    const backdropFiles = files.filter((name) => /^backdrop-(infantry|resources|resource-buildings|training|hybrid|armored)\.jpg$/.test(name));
    const hashes = (names: readonly string[]) => names.map((name) =>
      createHash('sha256').update(readFileSync(path.join(technologyAssetDirectory, name))).digest('hex'));

    expect(levelFiles).toHaveLength(48);
    expect(new Set(hashes(levelFiles)).size).toBe(48);
    expect(backdropFiles).toHaveLength(6);
    expect(new Set(hashes(backdropFiles)).size).toBe(6);
    expect(existsSync(path.join(technologyAssetDirectory, 'dossier.png'))).toBe(false);

    const fieldArtBytes = [...levelFiles, ...backdropFiles]
      .reduce((total, name) => total + statSync(path.join(technologyAssetDirectory, name)).size, 0);
    expect(fieldArtBytes).toBeLessThan(2_000_000);
  });

  it('builds a dossier model around the next useful level and its active project', () => {
    const model = buildTechnologyPanelModel(technologyView(
      { infantry: 3, resources: 2, resourceBuildings: 2, training: 1, hybrid: 1, armored: 4 },
      [{ branch: 'infantry', targetLevel: 4, progress: 0.375, etaSeconds: 10.25 }, null],
    ), 'infantry');

    expect(model.inspected.level).toBe(4);
    expect(model.inspected.name).toBe('Field Signals');
    expect(model.levels.map((level) => level.state)).toEqual([
      'completed', 'completed', 'current', 'researching', 'locked', 'locked', 'locked', 'locked',
    ]);
    expect(model.canResearch).toBe(false);
    expect(model.active?.percent).toBe(38);
    expect(model.active?.title).toBe('Infantry Doctrine · Level IV');
  });

  it('explains when both authoritative research slots are occupied', () => {
    const model = buildTechnologyPanelModel(technologyView(
      { infantry: 3, resources: 2, resourceBuildings: 2, training: 1, hybrid: 1, armored: 4 },
      [
        { branch: 'infantry', targetLevel: 4, progress: 0.25, etaSeconds: 18 },
        { branch: 'armored', targetLevel: 5, progress: 0.5, etaSeconds: 12 },
      ],
    ), 'resources', 3);

    expect(model.inspected.level).toBe(3);
    expect(model.levels[2].state).toBe('available');
    expect(model.canResearch).toBe(false);
    expect(model.blockedReason).toBe('Both research slots are occupied.');
  });
});
