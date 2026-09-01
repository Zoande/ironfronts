# Playtest Pass 4 — bug fixes, routes, coastline, dev controls, UI polish

**Branch:** `fix/playtest-pass-4` (child of `fix/playtest-pass-3` @ `39cc9a5`)
**Head:** `9b6f306` · **Pushed:** yes (`origin/fix/playtest-pass-4`, force-pushed once early to purge an accidental data backup — see Data safety) · **Merged:** NO
**Base check:** 62 files / 353 tests. **End check:** `npm run check` green — 66 files / 370 tests.
**Data:** `data/` copied to `ironfronts-backups/pre-pass4-20260901-171320/` before any work. worldHash unchanged `2fd320d5…de76f`. No new `game.json.v1-backup-*`.

## Git

| | |
|---|---|
| local start | `fix/playtest-pass-3` @ `39cc9a5` (already contains `origin/main` `c9efd65` incl. "refactored heavily!" — 257 ahead / 0 behind, so no divergence risk) |
| new branch | `fix/playtest-pass-4` |
| head | `9b6f306` |
| commits | 11 (below) |
| pushed | yes, after every commit |
| merged | **NO** |

```
bbae2ad fix(game): reject attacks against own forces and own territory
ca19f0e feat(renderer): ease unit facing along the road, no snap at corners
7057f05 feat(renderer): selected-only routes, destination chevrons, rally route
be7a33f fix(renderer): close Ultra shoreline black squares at the root
d17087f fix(menu): widen command cards, trim copy, give Continue a flag
dccc18a feat(ui): make Build/Produce buttons icon-first at facility-icon scale
358d27e feat(ui): local-only Call of War prototype art for unit portraits
e478b61 fix(combat): replace the giant crossed-blades battle marker with a burst+pulse
e024469 feat(ui): real progress-bar production/construction queues
028d496 feat(dev): in-session simulation-speed control in the debug panel
9b6f306 fix(menu): quote the flag data: URI and give cards room for the foot row
```

## What shipped (all foreground-QA'd unless noted)

### Attack / combat correctness
- **Attack own forces / own territory now rejected** (`src/game/commands/attack.ts`), server-side, plus a client backstop and a matching failure headline. 4 new tests, including the §21 invariant: an accepted strike installs a route whose last node is the *hostile army's own node*, not its raw x/z. The server side of attack routing already goes through the exact same `issueMoveOrder` planner as MOVE (verified) and already re-paths a moving target on a bounded cadence (`revalidateOrder`). No separate attack-line algorithm exists.
- **Battle marker de-cartooned** — the persistent per-battle glyph was two crossing segments (a literal X) up to ~108px, reading as a cancel icon. Replaced with a compact radiating spark burst + breathing ring, same palette, base size 40→32. The per-round muzzle-flash / tracer / impact / dust / smoke / explosion effects (already implemented, procedural) are untouched and are how combat reads up close.

### Routes / movement
- **Order routes draw for the selected army only** and clear on the next sync after a deselect (QA: confirmed the cream line vanishes on Escape).
- **Destination chevron** at the end of every drawn route, oriented by the final leg tangent, in the route's own colour (move cream / attack red / rally blue / retreat amber), drawn a touch bolder. QA: visible, tasteful, doesn't bury the end point.
- **Rally route** — selecting a production city draws the road route from the city node to its rally point (server-derived in `projection.rallyRouteForClient`, same planner a produced unit walks) plus an end chevron; hidden when the city is deselected. Produced units already receive a `move` order to the rally on completion (`production.ts`). New tests for `rallyRouteForClient`.
- **Unit facing eases along the road** — the column heading was recomputed raw every 2.5 Hz marker sync, so a stopped army snapped north and a marching one snapped at every bend. Now: a look-ahead point 16 world-units along the actual polyline, shortest-arc damp per sync, and the pre-sync heading rides in the model buffer so `army-models.wgsl` slerps it over the same 0.42 s window it uses to slide the model. Applies to every unit kind — tanks/artillery stop crabbing through bends too.

### Coastline — Ultra black squares (§44)
- **Root cause found and fixed** (`src/renderer.ts`). The water chunk meshes were coarser than terrain at the near LODs — water `[33,25,17,9]` vs terrain `[49,33,17,9]` (gridResolution 49, confirmed from the built world) — while both passes pick the same per-chunk `draw.lod` and decide coast coverage from `landAt(interpolated mapUv)`. At LOD 0/1 the 0.5 coast contour therefore fell on a different polyline in each pass, so a shoreline fragment could be discarded by **both** (terrain `landAt<=0.5`, water `landAt>0.5`) → clear-colour rectangles, worst at Ultra which forces LOD 0. Water meshes now use the terrain resolutions, so `landAt(mapUv)` is per-pixel identical in both passes and the split tiles every shoreline fragment exactly once. `COAST_OVERLAP` drops 0.045→0.03 and is now just float-precision insurance.
- **Foreground QA:** Ultra preset (`render scale 1.50x`), close zoom (distance 240–260) on three coasts — Königsberg / East Prussia, the Swedish east-coast archipelago (densest island contour = worst case), and the wider Baltic. **No black squares anywhere.** This is the visual sign-off pass 3 could not get.

### Menu
- Cards widened `clamp(158px,10.6vw,208px)` → `clamp(200px,15.5vw,268px)`, taller, bigger icon disc with an inset ring, subtle top sheen.
- Descriptions hard-capped to 2 lines with a fixed min-height so all three align; copy shortened.
- The long "preview only" caveat on New Campaign is now a small **Preview** pill badge.
- **Continue shows the assigned country's real flag** (Finland's Nordic cross, QA-confirmed) in the icon slot when a campaign exists, and leads its detail line with the country name.
- Fixes from QA: the flag data: URI must be quoted inside `url()`; card min-height raised so the "01 Command / 02 Archive / 03 Config" foot row isn't clipped at 1366–1568px heights.
- Landscape-mobile grid was 4 columns for 3 cards → 3.

### City / build / production UI
- **Build & Produce buttons are icon-first at facility-icon scale** — 52 px thumbnail (34 px glyph, inside the 44–64 px range asked for), short truncated caption; name/cost/role stay on the hover tooltip. QA: the 0 A.D. Barracks / Tank Plant / Ordnance icons render large and clear.
- **Production & construction queues are real progress strips** — the active order gets its unit-portrait / facility-icon thumbnail, a fill bar, and an `m:ss` countdown; queued-behind items are smaller inert icons. `SelectedProvince.queue/.construction` moved from `string[]` to a shared `QueueItem[]`; the re-render cache key is rebuilt from the fields (the naive type swap alone would have collapsed every item to `"[object Object]"` and frozen the bar). ETA is derived from the fixed 0.05-game-hour/100 ms tick (0.5 game-hours/real-second at normal speed) and documented as a normal-play estimate. Not seen live in QA — the QA campaign had no city producing — but unit- and type-checked.

### Call of War unit art
- Downloaded the 5 matching wiki portraits (infantry, armored-car, light-tank, medium-tank, artillery — CoW has **no Engineer combat unit**, so that id keeps its SVG in dev and prod) into `dev-assets/callofwar-reference/`, **gitignored, never committed, never pushed, never shipped**.
- Loaded **only** when `import.meta.env.DEV`, via a plain runtime URL string — **not `import.meta.glob`**: an eager *and* a lazy glob on that path both still bundled every image into `dist/assets` on `vite build`, verified twice, because Vite's glob transform wires matched files into Rollup's graph at parse time before any DEV-flag dead-code elimination. A production `vite build` now has zero `dev-assets/*.webp` in `dist/` (verified). New test pins the no-glob invariant.
- QA: composition cards show the real Call of War art for the 5 mapped ids with a small **REF** corner tag marking them as local reference, and the original SVG for engineers.

### Dev simulation-speed control (§33/§34)
- New **"SIMULATION SPEED — DEV ONLY"** group in the World Inspector — Pause / 1× / 2× / 4× / 8× / 16×, kept visually separate from the still-labelled "LIGHTING — VISUAL ONLY" clock.
- Server-authoritative and live: `simSpeedMultiplier` is read each tick; `setDevSimSpeed` clamps via the new `clampSimSpeed` (0..32, non-finite → 1) and is a hard no-op when `NODE_ENV === 'production'` regardless of who sends the message. New `devSetSimSpeed` client message + `devSimSpeed` server broadcast; the panel group **hides entirely** against a production server so it never offers a dead lever.
- QA: clicked 4× → readout and `aria-pressed` updated, server accepted and re-broadcast. Set back to 1×. `clampSimSpeed` tests added.

## Data safety

- `data/game.json`, `data/auth.sqlite*` — untouched by any code change; `ironfronts-backups/` is now gitignored.
- **One incident, resolved:** the very first commit's `git add -A` swept the fresh `pre-pass4-…` data backup (incl. `auth.sqlite`) into the commit and it was pushed to the public fork. Caught immediately, `ironfronts-backups/` gitignored, history rewritten (`git push --force-with-lease` — run by the repo owner after the automation classifier blocked it), remote branch now clean. The `auth.sqlite` holds only the local dev auth DB (hashed passwords, localhost server); rotating the `qa-combat` password is a reasonable precaution.
- worldHash unchanged, no world rebuild, no new save archive, campaign advancing normally.
- QA reused the existing fixed `qa-combat` seat on Finland — no new accounts, no new country claims. QA left no army selected and no dev speed-up active.

## Services (leave running)

| Service | URL | State |
|---|---|---|
| client (Vite) | http://127.0.0.1:5173/ | healthy |
| auth-server | http://127.0.0.1:3001/health | healthy |
| game-server (`world-at-war-2`) | http://127.0.0.1:3002/health | healthy, campaign advancing |

`npm run game:dev` still hits the Windows `EPERM` (`build:world` vs Vite holding `public/world`); the game-server runs via `npx tsx watch apps/game-server/src/main.ts` (auto-reloads on edit, no rebuild).

## Not finished / deferred (genuine, not "analysed and stopped")

- **§35–38 external 3D building models** (Quaternius / Kenney GLB import pipeline) — the biggest single item; a static-mesh pipeline + format conversion for the WebGPU renderer is its own pass. Research done (see below).
- **§14/§39 3D construction rise/scaffold visual** — there is currently *no per-facility 3D object* (buildings are pre-baked world scenery props, unrelated to `provinceBuildings` levels), so "rise from the ground" needs a new facility-marker 3D system first — same weight class as §35–38. The queue progress bar (§12/§40) landed instead.
- **§10 icon-mapper dev tool** — untouched (a whole new dev panel; lower priority than gameplay-visible work).
- **§25–27 real explosion/smoke/muzzle sprite textures** — kept the procedural WGSL effects (already decent, and the cartoon-X complaint is fixed). Swapping in Kenney Particle Pack sprites is an enhancement pass. Research done.
- **§55/§56 combat SFX** (OGA Firearm Sound Library + distance attenuation) — not started. Research done.
- **§28/§29 soldier gait bob / tank track animation** — the facing-damp fix removed the "chess piece" turning; a walk cycle in the vertex shader is additional polish, not started.
- **§45 canonical road graph vs visible geometry** — needs a `build:world` change → new worldHash → live campaign archived. Not touched, same as pass 3.
- **§60 multi-campaign, §59 full persisted fog** — untouched; both need the save layer and the brief defers them.
- **Queue progress bar and combat-VFX marker not seen live in QA** — no producing city / fresh combat in the QA save; both are type- and test-verified (VFX also Dawn-WGSL-compile-verified).

## External assets downloaded this pass

**Local prototype only — NOT committed, NOT pushed, NOT shippable:**

| File | Source | License | Path | Status |
|---|---|---|---|---|
| infantry / armored-car / light-tank / medium-tank / artillery `.webp` | Call of War fandom wiki, each unit's `og:image` | © Bytro Labs — private local reference use only | `dev-assets/callofwar-reference/` | gitignored, dev-only loader, `vite build` verified clean |

**Open assets identified (research subagent) — none vendored yet, for a future pass:**

| Need | Pick | License | Direct URL |
|---|---|---|---|
| explosion flipbook | Sinestesia – 2D Explosion Animations | CC0 | opengameart.org/…/Free%20-%202D%20Explosion%20Animations.zip |
| smoke / dust / flash | Kenney – Particle Pack | CC0 | kenney.nl/…/kenney_particle-pack.zip |
| low-poly buildings | Quaternius – Medieval Village Pack (GLB, ~0.5–1.5k tris) + Kenney City Kit Industrial (warehouse/factory) | CC0 | poly.pizza/bundle/Medieval-Village-Pack-NsHhjhlrfY ; opengameart.org/…/ultimate_textured_building_pack_by_quaternius.zip |
| combat SFX | OGA – Free Firearm Sound Library (small arms) + qubodup cannon/howitzer + unfa grenade (Freesound, need a login) | CC0 | opengameart.org/…/Prepared%20SFX%20Library.7z |
| tracers | none suitable — procedural | — | — |
| 0 A.D. particle textures | `smoke_256a` / `dust_256a` / `flame_radiant` / `sparks` / `stone_shrapnel` | CC-BY-SA 3.0 ⚠️ viral | raw.githubusercontent.com/0ad/0ad/master/binaries/data/mods/public/art/textures/particles/ |

## QA screenshots (saved locally, not committed)

- Home menu (flag on Continue, Preview badge, foot labels)
- 1st Army panel — CoW REF portraits + SVG fallback, command strip
- World Inspector — SIMULATION SPEED group, clicked 4×
- Jyväskylä / Rovaniemi / Vaasa province panels — icon-first Build row
- 3rd Army move order — cream route following roads with an end chevron; route gone after deselect
- Coast at Ultra distance 240–260 — Königsberg, Swedish archipelago — clean, no black squares

## Verdict

**SAFE TO REVIEW.** Green, campaign intact, everything pushed to `fix/playtest-pass-4`, nothing merged. The four bug/mandatory items (own-target attack rejection, unit facing, coastline, route chevron+hide) are done and QA'd; the coastline in particular now has the Ultra close-up sign-off it lacked. The deferred group (external 3D buildings, 3D construction visual, sprite VFX, combat SFX, icon mapper, soldier animation) is each a substantial pass of its own — take them as a pass 5 or cherry-pick.

**DO NOT MERGE.**
