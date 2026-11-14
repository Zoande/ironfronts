# Original army and transport assets

Eleven original Blender-authored families cover every playable troop, warship and convoy.
Infantry, engineers and militia have separate field equipment and silhouettes; light and medium tanks use distinct geometry.
Battleships carry heavy turrets, destroyers carry sonar and depth charges, and submarines have a pressure hull, dive planes and periscopes.
Geometry, rigs, motion, material pixels and effect flipbooks come from the project's own Python sources.

| Family | Close triangles | Middle triangles | Distant triangles |
| --- | ---: | ---: | ---: |
| infantry | 37,832 | 15,888 | 5,294 |
| engineer | 40,564 | 17,036 | 5,673 |
| militia | 36,992 | 15,536 | 5,178 |
| armored-car | 23,572 | 9,900 | 3,252 |
| light-tank | 40,460 | 16,992 | 5,384 |
| tank | 41,932 | 17,610 | 5,660 |
| artillery | 11,940 | 5,014 | 1,609 |
| transport | 13,636 | 5,726 | 1,721 |
| battleship | 6,216 | 2,610 | 829 |
| destroyer | 5,700 | 2,394 | 767 |
| submarine | 6,356 | 2,668 | 858 |

## Rebuilding and editing

Run `npm run build:land-models` with Blender installed. Set `BLENDER_PATH` to
override the executable (tested with Blender 4.3.2 and 5.1.1). A family can be rebuilt with
`npm run build:land-models -- infantry` (use any family name from the table above).
The old infantry/tank npm commands now invoke this builder.

- `scripts/blender/build_land_armies.py`: geometry, rigs, textures, clips, LODs,
  GLB exports, metadata and studio previews.
- `scripts/blender/build_land_effects.py`: original smoke/fire flipbook pixels.
- This directory: editable `.blend` sources with relative texture references.
- `public/models/land/`: runtime exports and shared PNGs.
- `artifacts/land-armies/`: generated previews and local QA output (gitignored).

The builder overwrites generated files, including `.blend` files. Preserve manual
Blender edits separately or incorporate them into the builder before regenerating.
Blender uses metres, Z up and -Y forward; exported glTF uses Y up and +Z forward.
Land families use runtime scale 2. The 26-metre transport
uses scale 0.72 to fit the strategic map without overwhelming coastal settlements.

## Runtime behavior

All families, LOD geometry, baked animation palettes and shared textures load
before play. The three 2048-square material maps share one GPU texture array
(about 64 MiB including mipmaps). LOD switches at camera distances 180 and 600;
a 300,000-triangle budget per family reduces detail further in crowded views.
Wrapped copies outside the camera view are culled.

Eight clips are exported: Idle, Walk, Reverse, Fire, Reload, Deploy, Death and
Run. Runtime uses idle, distance-driven forward/reverse motion, firing, infantry
reload and death, with state blending. Deploy and Run are available for future
state-specific playback. Turrets aim independently of vehicle hulls. Authoritative
loss events leave a short death animation before the model fades.

Shots share the skeletal firing clock and muzzle sockets. Single rifle shots,
three-round armored-car bursts, vehicle
fire and arcing artillery shells produce timed impacts, debris, smoke and dust.
Recoil has a fast impulse and slower recovery; the rifle includes a bolt cycle.
Infantry gait advances by travelled distance (1.1-metre authored stride).
Weapons aim at the same visible model selected by their shot effects, including across the map seam.
Impacts target the near edge of visible vehicle hulls rather than their center.
Skeletal animation uses real elapsed time so slow frames cannot separate recoil
from its scheduled particles. Effects upload every rendered frame. Visual firing is illustrative, not one
projectile per simulation damage event, and uses only visible target positions.

All ships reuse the material atlas and resident LOD pipeline. It rides sea level,
with subtle roll/pitch/heave, an animated propeller and a wake only when moving.
Both hull and wake follow the rendered wave height.
Ship visibility is tested at sea level, not against seabed elevation. The common
clip contract includes inert combat clips; the unarmed transport does not fire.

Close zoom uses the actual height field plus 24 units of clearance (at least 80),
instead of the former 42-unit clearance margin.

## Validation

Run `npm run check` and `npm run build`. With the dev server on port 5173, run
`npm run check:land-visuals` for an isolated WebGPU scene (no account or campaign
changes). Set `IRONFRONTS_BROWSER` to override the Chrome executable.
The fixture captures combat, movement, loss, zoom, 400-model scenes, infantry
inspection, moving/idle ships and a combined coastal scene, records frame timings, and fails on missing families, absent live effects or GPU errors.
Unit checks verify exported LODs, clips, joints, sockets and shot timing.
Open `artifacts/land-armies/review.html` for the generated visual review.

Artillery is represented by its gun and carriage; trees and cities use their existing assets.

`node scripts/qa/naval-models-check.mjs` verifies all eleven families in an isolated WebGPU scene, captures the land and naval rosters, and fails on missing models or GPU errors. `node scripts/qa/army-upgrades-check.mjs` and `node scripts/qa/command-ui-check.mjs` verify the refit dialog and army panels at phone and desktop widths. On Linux, set `IRONFRONTS_BROWSER=/usr/bin/chromium`; in environments requiring it, set `IRONFRONTS_NO_SANDBOX=true`.
