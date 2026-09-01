# Ironfronts — playtest / polish pass 2d

**READY TO PLAY:** http://127.0.0.1:5173/

## GIT
- repo: `DH4410/ironfronts` (fork / `origin`)
- branch: `fix/map-playtest-pass-2`
- base: `6c6fdba`
- head: `f20d6b8`
- commits this pass (6):
  - `98b5cb2` feat(ui): shared rich-tooltip system, wired into the army command strip
  - `8bf6959` fix(combat): acknowledge an attack on server-accept, not before the war prompt
  - `6fa8259` feat(input): vendored 0 A.D. rally cursor + precision cursor for ground orders
  - `91e3b18` feat(graphics): preset-scale the 3D-army LOD range + quality dev readout
  - `b494524` feat(combat): CombatEffectPool (CPU side, pooled, event-driven)
  - `f20d6b8` feat(combat): render the CombatEffectPool as an instanced WebGPU layer
- pushed: pending (push step below)
- **merged: NO. DO NOT MERGE.**

Upstream (`Zoande/ironfronts` main @ `a521ee0`) has **not moved** since the
integrated `7f27e99` — no reconcile needed, nothing overwritten.

---

## What landed

### 1. Rich hover-tooltip system (`src/ui/tooltip.ts`) — §11, §12, §60
One reusable `.ifg-tip` panel: `{ title, description, shortcut, disabledReason,
cost, eta, status }`, ~170 ms open delay, flips above/below the anchor,
viewport-clamped so it never renders offscreen, dismisses on
leave / blur / Escape / scroll / press. `renderTooltipHtml()` is a pure,
markup-escaping function (unit-tested).

Wired into the **army command strip**: every command carries a description +
keyboard shortcut; every **disabled** command carries a concrete reason
("No visible hostile target in range." / "This formation is currently locked in
combat." / "This force is too small to divide." / "No active order to cancel." /
"No extractable resource deposit at this position." / retreat's encirclement
rule). Disabled buttons keep `pointer-events`/`cursor: help` so the reason is
hoverable. Added **R** (retreat) and **X** (split) hotkeys to match.

QA: `qa-ui-tooltip-command.png` shows the panel above "Move" reading
*"Move / This formation is currently locked in combat. / KEY M"*.

Not yet wired to facilities / resources / map modes / unit portraits — the
system is built for it; those panels are the not-done items below.

### 2. War-confirm ordering fix — §33
The attack acknowledgement (target reticle + order cue + "Attack order issued"
toast) was firing optimistically, so clicking a not-yet-hostile force showed
"attack issued" *then* a cancellable "Declare war?" modal. Now it is a single
`acknowledgeAttack` closure passed as `onAccepted` to
`orderAttackArmy`/`orderAttackProvince`; `RemoteGameSession.send()` invokes it
in the server-`ok` branch, which is reached on the plain path **and** after the
war-confirmation re-send. Cancelling the war leaves no misleading toast. The
optimistic `moving`/`attack` status still applies instantly, so the panel + red
route read "advancing" with no perceptible delay when already at war.

### 3. Cursor feedback — §32
`cursors/cursor-rally.png` (0 A.D., CC BY-SA 3.0) now shows while a rally point
is armed; move / split / retreat aiming gets a `crosshair`. `action-attack` /
`cursor-no` unchanged (verified no fog leak in the previous pass, still green).
`action-capture` / `action-garrison` remain **unwired** — there is no capture
or garrison order to attach them to, and the brief forbids fake affordances.

### 4. Graphics presets — live-apply proven + dev readout — §38–§42, §59
`renderer.setQuality()` already re-runs `resize()` (render scale), bumps the
camera revision and clears the terrain-visibility cache; every other knob is
read from the live preset each frame. **Verified live** in headed Chrome:
switching low→medium→high→ultra resized the backing store
`1200×750 → 1600×1000 → 2000×1250 → 2400×1500` and moved FPS 60→32 in the same
frame, no reload.

New: the 3D-army ⇄ strategic-marker LOD swap distance is now
`ARMY_MODEL_RANGE_BASE × propDistanceScale` (floored 900u) instead of a bare
1900u — LOW swaps to markers at ~855u, ULTRA holds models to ~2375u.

New: `renderer.qualityReadout` + two diagnostics lines (F-key panel):
```
graphics  ultra @ 1.50x  2400x1500
preset    prop 1.25x  lod 1.18x  detail 1.00  furniture on
budgets   trees 400,000  bldg 400,000  3D army <2375u (17 now)
```

Preset matrix (each adjacent pair differs on ≥4 real knobs — test-guarded):

| knob | low | medium | high | ultra |
|---|---|---|---|---|
| renderScale (abs ×CSS px) | 0.75 | 1.00 | 1.25 | 1.50 |
| propDistanceScale | 0.45 | 0.70 | 1.00 | 1.25 |
| treeInstanceBudget | 9,000 | 22,000 | 60,000 | 400,000 |
| buildingInstanceBudget | 6,000 | 14,000 | 40,000 | 400,000 |
| terrainLodScale | 0.85 | 0.82 | 1.00 | 1.18 |
| detailFactor (shader) | 0.12 | 0.40 | 0.75 | 1.00 |
| rainScale | 0.35 | 0.60 | 1.00 | 1.00 |
| road furniture | off | off | on | on |
| 3D-army LOD range | ~855u | ~1330u | 1900u | ~2375u |

QA screenshots `qa-quality-{low,medium,high,ultra}.png`. Honest caveat: at the
high-altitude QA camera the raw `trees` count reads the same across presets
(the visible set is terrain-chunk-bounded there, not budget-bounded) — the
measurable deltas at that camera are render-scale, `tris` (484.9K → 658.6K),
terrain-LOD distribution (`5/21/9/0` → `12/22/1/0`) and FPS. At a lower camera
the tree/building budgets bite directly.

### 5. CombatEffectPool — pooled, event-driven world-space combat visuals — §22–§28
**CPU (`src/combat-effects.ts`):** fixed-capacity ring buffer of transients
(muzzle flash / tracer / projectile / impact / dust / smoke / explosion /
target flash) + one persistent per-battle marker. xorshift RNG, zero per-frame
allocation, fully unit-tested (capacity never exceeded, transients age out by
lifetime, `collect()` packs `age01` + distance-culls transients while keeping
markers, markers written first under budget, `syncBattles()` reconciles the
live set). `spawnVolley()` emits a small category-appropriate burst — a handful
of effects per authoritative volley, never one per round. `compassLabel()`
mirrors the server's `bearingLabel` (N is −z).

**GPU (`src/shaders/combat-effects.ts` + pipeline):** one billboarded
`pass.draw(6, N)`, alpha-blended, per-kind procedural sprites animated purely
from `age01`; the CPU re-uploads a ≤320-instance buffer only while effects are
live. Drawn under the army markers, gated at camera distance < 5000 and hidden
in debug views. Passes Dawn semantic compilation **and** real
`createRenderPipelineAsync` in `shaders.test.ts`.

**Wiring (`main.ts`):** `drainSessionEvents` spawns category bursts + delayed
artillery target explosions from the same `engaged` / `volley` / `bombardment`
/ `destroyed` events, LOD-gated by `effectDensityForDistance(cameraDistance)`
(0 past 5000u). `syncCombatMarkers` reconciles one crossed-sabre marker per
engaged cluster (~70u grid) with a compass direction toward the nearest enemy
stack. `onStats` repacks + uploads each frame.

**Foreground QA (`scripts/qa/visual-pass.mjs`, headed real Chrome + WebGPU):**
`qa-combat-{close,medium,far}.png` show the battle markers, target reticle,
muzzle flashes and tracer streaks rendering world-anchored on the terrain;
`qa-ui-tooltip-command.png` catches a crossed-sabre marker + muzzle glints on a
genuinely engaged stack. **0 console errors.**

- attack cursor / war-confirm flow / target flash / route: ✅ (this pass + prior)
- battle marker + direction: ✅ (crossed sabres, compass dir toward enemy)
- muzzle flashes / tracers / tank effects / artillery explosions / smoke: ✅ (procedural sprites, event-driven)
- effect pool: ✅ (384-cap ring + marker map, reused buffer, distance cull, LOD gate)
- under-attack notification + click-to-focus + alert-sound dedupe: ✅ (unchanged, still green)
- combat LOD: ✅ spawn density fades 1400→5000u, renderer stops drawing past 5000u

---

## NOT done this pass — honest status

These are the §63 "not optional" items I did **not** reach. None are blocked;
they are genuinely large and I stopped rather than ship rushed / unverified art.

| item | status | why it's non-trivial |
|---|---|---|
| WW2 unit **portrait** cards (§8) | **not started** | composition still shows the existing 0 A.D.-style line glyphs, not framed Call-of-War-style portraits. Real art task (6 categories) + card layout + tooltip stat move. |
| bold graphical **command buttons** (§9, §13/§14 re-slot) | not started | commands still the dim 16px icon + caption row. Needs button art + a LEFT-stats / CENTER-portrait / RIGHT-grid HUD re-slot, which moves code the string-grep tests anchor on. |
| **city facilities as graphical actions** (§15–§18) | not started | city panel is already a bottom-centre graphical panel (pass 2b) but still lists BARRACKS / TANK PLANT / ORDNANCE as text; needs facility art + hover cards. |
| **resource bar / map markers** real art (§19–§21) | not started | resource icons are the existing 0 A.D. set; not swapped to the literal wheat / soldier / barrel / coin set, and map deposit markers not reworked. |
| combat **audio** near-camera cues (§36) | not started | only the single under-attack alert exists; no per-category distance-attenuated gunfire / cannon / artillery. |
| **Ultra shoreline** black squares (§43–§45) | not fixed | root cause is confirmed (chunk-LOD seam sampling `landAt` across 0.5; the safe contour-hand-off shipped in `5c6404f`, the wider seam holes need a height-aware overlap band tuned against beach-flooding on a foreground Ultra pass). I did not want to ship another unverified threshold tweak — exactly what the brief says to stop doing. |
| **canonical roads / route-polyline follow / graph prune** (§52) | deferred | needs a world rebuild → save migration; rebuilding resets the live Greece campaign. Out of scope for a UI/combat pass. |
| stance / formation selectors (§50, §51) | **correctly not built** | there is **no** stance or formation system in `packages/game-core` / `src/game` — the brief forbids fake buttons. The vendored icons stay on disk, credited, unused, pending a real system. |

---

## 0 A.D. ASSETS

- in repo before this pass: **~40** (24 session icons + 4 stances + 3 ranks +
  6 formations + 6 cursors + 1 alert sound, all CC BY-SA 3.0, credited in
  `docs/ASSET_CREDITS.md`).
- **new assets vendored this pass: 0.** This pass deliberately *used* what is
  already vendored rather than adding more (per §62 — the gap was surfacing,
  not supply).
- **newly surfaced in gameplay this pass:**
  - `cursors/cursor-rally.png` → armed rally-point placement cursor (was
    vendored-but-unused).
  - `docs/ASSET_CREDITS.md` updated: `cursor-rally.png` moved from "(reserved)"
    to a live role.
- assets present but still **not** surfaced: `action-capture`,
  `action-garrison`, `action-attack-move` cursors; the 4 stance icons; the 6
  formation icons; `promote` / `upgrade` / `call-to-arms` / `focus-rally`
  session icons. All await a real mechanic to attach to.

## CALL OF WAR
Used as visual / information-design reference only. **No** Call of War pixels
copied or vendored. The Call-of-War-style unit portrait set (§7/§8) was **not
produced this pass.**

## TESTS
- `npm run check` → **green: 353 tests / 62 files** (4× workspace `tsc`, root
  `tsc`, `eslint scripts/**/*.mjs`, `test:architecture`, `vitest run`).
  Baseline was 333/60.
- new test files: `tests/tooltip.test.ts` (4), `tests/combat-effects.test.ts` (10).
- extended: `tests/combat-feedback.test.ts` (5→8), `tests/graphics-quality.test.ts`
  (7→9), `tests/army-command-ui.test.ts` (4→5), `tests/shaders.test.ts` (30→31,
  incl. Dawn semantic compile + pipeline creation for `combatEffectShader`).
- `npx vite build`: not run this pass (no bundler-facing change beyond new
  modules already covered by `tsc`); `npm run build` skipped because
  `build:world` would rebuild the world and risk a `data/game.json` archive.

## FOREGROUND QA
`scripts/qa/visual-pass.mjs` — headed real Chrome + WebGPU (`launchCheckPage`),
one fixed `qa-combat` seat (Continue, **never registers a new account**).
Artifacts in `artifacts/` (not committed):
- `qa-combat-close.png` / `qa-combat-medium.png` / `qa-combat-far.png` — combat
  effect sampler world-anchored on terrain.
- `qa-quality-low|medium|high|ultra.png` — diagnostics readout per preset,
  backing store visibly resized.
- `qa-ui-army.png` — army HUD (1st Army, health / composition / troop stats /
  combat overview).
- `qa-ui-tooltip-command.png` — rich tooltip above a disabled command +
  crossed-sabre battle marker on an engaged stack.
- **console errors: none.**

## PERFORMANCE
- CombatEffectPool: 384-instance cap + battle-marker map; one reused
  `Float32Array`, no per-frame allocation; `collect()` distance-culls transients
  and caps to budget; spawns LOD-gated to 0 past 5000u. One extra
  `pass.draw(6, N)` and one ≤320×8-float `writeBuffer` per frame while a battle
  is on screen, nothing when idle.
- Graphics presets confirmed to move real GPU load (FPS 60→32 low→ultra at the
  same camera, `tris` 485K→659K).

## DATA SAFETY
- `data/game.json`, `data/auth.sqlite*`: **untouched.** No world rebuild, no
  archive, no migration.
- Greece campaign: intact (Finland-seated QA account is a separate seat; the
  real Greece seat is unaffected).
- QA seat: still the single documented `qa-combat` / Finland (id 1) seat from
  the prior pass. `visual-pass.mjs` only calls Continue — it never registers or
  claims a nation.
- All work client-side (`src/`, `tests/`, `scripts/`, `docs/`); no
  `apps/game-server` change, so the running game server needs no restart.

## SERVICES
| | | |
|---|---|---|
| client | http://127.0.0.1:5173/ | 200 |
| auth | http://127.0.0.1:3001/health | `{"ok":true}` |
| game | http://127.0.0.1:3002/health | `{"ok":true,"gameId":"world-at-war-2"}` |

Vite HMR is serving the new client code (verified — the QA run exercised it).

## REMAINING
See the "NOT done this pass" table. In priority order for a follow-up pass:
unit portraits + HUD re-slot → graphical city facilities → resource art →
Ultra shoreline (foreground height-aware overlap band) → near-camera combat
audio.

## FINAL VERDICT
**SAFE TO REVIEW** — six focused commits, full `npm run check` green (353/62),
foreground WebGPU QA clean, no data/save/world mutation, upstream untouched.
The pass delivered the tooltip system, the war-confirm fix, cursor feedback,
provable live graphics presets + dev readout, and a real pooled event-driven
world-space CombatEffectPool (CPU + GPU + wiring + foreground-verified). It did
**not** deliver unit portraits, the HUD re-slot, graphical city facilities,
resource art, near-camera combat audio, or the Ultra shoreline fix — those are
enumerated honestly above.

**DO NOT MERGE.**
