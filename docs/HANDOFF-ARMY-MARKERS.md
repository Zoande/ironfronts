# Army marker redesign handoff

Updated: 2026-09-09

## Goal

Replace the unclear on-map army badge with a Call-of-War-like composited
counter:

- one reusable painted/stamped backplate;
- separate live unit silhouettes;
- exact per-type counts assembled at runtime;
- clear health, owner colour, selected, engaged, and unknown-contact states;
- all six current troop categories remain distinguishable.

`docs/ART-NEEDS.md` was followed for alpha trimming, Lanczos resizing,
small-size legibility, painted/stamped styling, registry, and credits.

## Branch and safety

- Work branch: `feat/callofwar-army-markers-v2`
- Branch point: `82dd821`
- The older `feat/callofwar-army-markers` already existed at an older commit,
  so the `-v2` branch avoids rewriting it.
- Do not continue this work on `main`.
- Preserve the route scratch layout in `src/app/bootstrap.ts`: 8 floats per segment,
  with fraction at +5, retreat at +6, and arrow at +7.

## Implementation

- Six genuine-alpha 96x96 silhouettes: infantry, engineer, armoured car,
  light tank, medium tank, and artillery.
- A six-cell 576x96 runtime atlas at
  `src/ui/assets/army-unit-silhouettes.png`.
- `scripts/prepare-army-marker-silhouettes.mjs` removes baked checkerboards,
  isolates the subject, and Lanczos-downscales each source.
- The six individual sprites are registered in `src/ui/icons.ts`.
- Strategic composition now preserves six exact identities. Close-range 3D
  models remain mapped onto four existing compatible model families.
- Each GPU marker record now uses 28 floats / 7 vec4 values for base data,
  state, six counts, six kinds, and interpolated motion.
- The silhouette atlas is bound at WebGPU binding 16.
- Procedural glyphs were replaced by atlas silhouettes with half-texel UV
  insets to avoid neighbouring-cell bleed.
- The main counter presents the two largest exact categories. Selecting a
  close-range formation opens all six categories in a compact two-column,
  three-row shield; unselected strategic counters stay compact.
- `src/ui/assets/skins/army-counter-cartouche.png` supplies the live counter
  surface and `army-roster-plaque.png` is bound at WebGPU binding 17. Owner
  wash, health, selection, engagement, and fog-safe `?` state remain live.
- Silhouettes and stencil numerals are measured in physical framebuffer pixels,
  so neither stretches with the counter aspect or graphics render scale.

## 2026-09-09 quality follow-up

- Replaced the first boxier roster/control assets with a tapered shield and a
  wide command medallion after authenticated browser inspection.
- Added dedicated generated building and production-queue plaques instead of
  stretching one control skin from tiny toolbar scale to large facility scale.
- Building controls are larger, use image-only labels, and keep names/costs in
  accessible hover/focus tooltips. Queue art has a separate progress groove.
- Major HUD surfaces, diplomacy, dialogs, notices, status ribbons, and rich
  tooltips use generated skins. Skin variables now live on `:root`, because
  dialogs/tooltips are mounted directly under `document.body`.
- Replaced the five low-resolution menu source-sheet crops (edge, torn frame,
  fastener, compass, grid) with original high-resolution true-alpha art.
  Nine-slice/repeat compositing prevents whole-image stretching.
- `scripts/qa/prepare-army-ui-fixture.mjs` creates an isolated six-type Finland
  save and refuses to overwrite its input. `visual-pass.mjs` no longer suggests
  the mutating combat harness if the QA seat is missing.

## Generated source files

Sources are stored outside the repository under:

`C:\Users\dimah\.codex\generated_images\01a07cbe-934b-7b62-bd93-3bfc096b5146`

- `exec-8b31d517-c872-421b-8766-a590e6e29d05.png` - infantry
- `exec-d2ba42d2-553b-48f7-808b-282b609770fa.png` - engineer
- `exec-2f40868d-0e8a-44bc-86a5-ab4d82e7e29c.png` - armoured car
- `exec-adf658f2-014b-4922-8b2b-06220c81c002.png` - light tank
- `exec-fd9f0e44-74cf-4655-980c-92b8c29efb87.png` - medium tank
- `exec-fd69b59e-c232-4e9c-9798-4a4b70b58d73.png` - artillery

The full generated skin/menu source inventory and prompt directions are in
`docs/ASSET_CREDITS.md`; runtime preparation uses
`scripts/prepare-generated-ui-skins.mjs`.

Four inputs contained baked checkerboards. The preparation script extracts
their warm bone/charcoal subject masks instead of copying that background.

## Verification completed

- `npx.cmd tsc --noEmit`
- `npx.cmd vitest run tests/army-map-presentation.test.ts tests/shaders.test.ts`
  - 2 files and 36 tests passed
  - Dawn WebGPU semantic shader compilation passed
- `npx.cmd vite build`
- `npm run lint:scripts`
- `git diff --check`
- `npm.cmd run check`
  - all 81 test files and 493 tests passed
- `scripts/qa/visual-pass.mjs`
  - authenticated WebGPU captures for menu, compact/selected counters, army
    detail, command tooltip, building controls, and diplomacy
  - no browser console errors

Authenticated WebGPU browser verification used a temporary copy of the combat
fixture; the real `data/game.json` was not changed. It confirmed:

- two-category strategic stacks remain legible at map scale;
- selecting a close-range stack reveals all six exact categories and counts;
- no atlas-cell bleeding is visible;
- health, owner, engaged, selected, and unknown states remain readable;
- command tooltips and existing painted troop portraits still render;
- no browser console errors or Vite error overlay appeared.

Focused local captures (not committed): `artifacts/qa-menu-dossier.png`,
`qa-combat-far.png`, `qa-ui-army.png`, `qa-ui-tooltip-command.png`,
`qa-ui-province-build.png`, and `qa-ui-diplomacy.png`.

## Main-line check

Both remotes were fetched immediately before publication. After this commit,
`upstream/main` is an ancestor of this branch and is 57 commits behind.
`origin/main` has diverged: this line is 65 commits ahead and 7 behind. Those
seven commits also remove many active game systems and art files, so they were
intentionally not merged or rebased into the tested feature work.

The feature branch should be reviewed and merged from its current local-main
lineage rather than force-updating or rewriting either remote main branch.
