# Original land army assets

Four Blender-authored families replace the former imported soldier/tank pipeline.
Infantry also represents engineers; light and medium tanks share one family.
Geometry, rigs, motion, material pixels and effect flipbooks are generated from
the project's own Python sources, without imported art.

| Family | Close triangles | Middle triangles | Distant triangles |
| --- | ---: | ---: | ---: |
| Infantry | 32,160 | 13,506 | 4,494 |
| Armored car | 23,420 | 9,836 | 3,230 |
| Tank | 41,024 | 17,230 | 5,535 |
| Artillery | 11,364 | 4,772 | 1,525 |

## Rebuilding and editing

Run `npm run build:land-models` with Blender installed. Set `BLENDER_PATH` to
override the executable (tested with Blender 5.1.1). A family can be rebuilt with
`npm run build:land-models -- infantry` (also `armored-car`, `tank`, `artillery`).
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
All four families use the same runtime scale of 2.

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

Shots share the skeletal firing clock and muzzle sockets. Rifle bursts, vehicle
fire and arcing artillery shells produce timed impacts, debris, smoke and dust.
Effects upload every rendered frame. Visual firing is illustrative, not one
projectile per simulation damage event, and uses only visible target positions.

## Validation

Run `npm run check` and `npm run build`. With the dev server on port 5173, run
`npm run check:land-visuals` for an isolated WebGPU scene (no account or campaign
changes). Set `IRONFRONTS_BROWSER` to override the Chrome executable.
The fixture captures combat, movement, loss, zoom and 400-model scenes, records
frame timings, and fails on missing families, absent live effects or GPU errors.
Unit checks verify exported LODs, clips, joints, sockets and shot timing.

This is the first original land art set. Artillery currently has no crew, and
engineers and tank subtypes deliberately share their family model. Ships, trees
and cities remain separate later work.
