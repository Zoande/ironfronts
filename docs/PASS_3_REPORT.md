# Playtest Pass 3 — UI / Portraits / Command / Map polish

**Branch:** `fix/playtest-pass-3` (child of `fix/map-playtest-pass-2` @ `7418e3c`)
**Head:** `c69c135`
**Baseline:** `npm run check` green — 62 files / 353 tests. worldHash `2fd320d5…de76f`.
**Data safety:** `data/` copied to `ironfronts-backups/pre-pass3-20260901-160757/` before any work.
**NOT merged. NOT rebased. main untouched.**

---

## Commits this pass (6)

| SHA | Summary |
|---|---|
| `dea0ec1` | feat(ui): image-backed unit portrait cards in the army panel |
| `1360891` | feat(ui): graphical command strip + icon Build/Produce buttons |
| `909da43` | feat(game): slower strategic movement + dev-only sim-speed control |
| `0e6029d` | feat: coastline seam band, smaller army models, louder combat/notify, graphics blurbs |
| `c69c135` | fix(ui): portrait-card framing + contrast after foreground QA |
| _(docs)_ | this report |

## What was implemented

### Priority 1 — unit portraits / command UI / city UI  (DONE)

- **Unit portrait cards (A/D).** Seven original WW2-style vector portraits authored for the
  repo — `src/ui/assets/units/{infantry,engineer,armored-car,light-tank,medium-tank,artillery,_fallback}.svg`
  — plus `src/ui/unit-portraits.ts`. The selected-army *Composition* strip now renders
  portrait-shaped image cards (prominent art, small caption, count badge, condition bar,
  role + numbers on the shared hover tooltip) instead of the old 48px line glyphs.
  Denser grid once a stack fields >4 unit families. Mapped only to the **six real roster
  ids**, so the panel never advertises a unit the game can't build.
  Also narrowed the army-panel re-render key (was `JSON.stringify(army)` on every 10 Hz
  `simulationTick` patch → now just the painted fields).
- **Command strip (C).** `MOVE / ATTACK / RETREAT / SPLIT / STOP / EXTRACT` are now chunky
  stamped-metal RTS buttons — 22px icons, inset bevel, gold hover wash, glowing active
  ring. Labels/keys/tooltips unchanged (verified: hovering a disabled MOVE shows
  "Move — This formation is currently locked in combat · KEY M").
- **City / Build / Produce (B/O).** Province-card `Build` and `Produce` rows went from
  plain text buttons to icon buttons: Produce shows the unit portrait thumbnail; Build
  shows the **0 A.D. facility icon** (`training` / `production` / `construction`). Short
  caption stays, cost + role move onto the tooltip, unaffordable buildings stay listed
  (disabled) with the cost spelled out on hover.

### Priority 2 — map / scale  (PARTIAL — renderer side only)

- **Coastline black squares (H).** `terrain.ts` now draws a thin band (0.045) *past* the
  `landAt = 0.5` shoreline contour, so a chunk-LOD seam that makes the terrain and water
  passes sample `landAt` on opposite sides of 0.5 can no longer leave a clear-colour
  (black at night) rectangle. The band is under the y = 0.35 water plane and the water
  surface is ~opaque, so it never floods the beach the way widening the *water* cut would.
  **Applied, not fully confirmed** — see "not finished".
- **Army model scale (I).** `army-models.ts` scale `1.95 → 1.7`, closer to the road
  ribbon (`ROAD_WIDTH = 1.2`, half-width 0.6). Ground lift already tracks scale.
- **Routes / roads (G).** No code change needed on the renderer side — pass 2 already
  draws the movement line from the authoritative `moveRoute` polyline segment-by-segment
  and heads the marching column along its first leg. The graph-editing half of G (delete
  roads into water, prune trivial neighbour roads) is **deliberately not started**: it is
  a `scripts/build-world.mjs` change → new worldHash → the live campaign would be
  archived. Offered as a separate opt-in.

### Priority 3 — combat feel / notifications / graphics / movement  (DONE)

- **Movement pace (J).** `STRATEGIC_MOVEMENT_SCALE 0.42 → 0.30` (~29% slower, strategic
  feel). Terrain ordering and the road bonus are unchanged.
- **Dev sim-speed (J).** `config.devSimSpeed` — `IRONFRONTS_DEV_SIM_SPEED` env, clamped
  `[0.25, 8]`, forced to `1` in production, logs a warning when active. Multiplies the sim
  tick dt so a local tester can fast-forward movement / production / combat. The existing
  visual time-of-day control (dawn/noon/sunset/night) is untouched and still there.
- **Combat feel (E).** Engaged map counters now pulse a red *glow ring*, not just a border.
- **Notifications (F).** Wider (288px), larger type, slide-in; combat alerts get a 3×
  pulsing halo so an attack is not missable; located alerts read "Jump to the fighting →".
  Reduced-motion respected. The 0 A.D. under-attack alert sound and click-to-focus from
  pass 2 are unchanged.
- **Graphics settings (K).** Verified every preset field is really consumed by the
  renderer (`renderer.ts` reads `propDistanceScale`, `terrainLodScale`, `detailFactor`,
  tree/building budgets, `furniture`, `rainScale`, render pixel ratio). Each preset blurb
  now spells out what it changes; the pause overlay already prints the live
  "Effective render scale 1.50x · ULTRA" readout.
- **Performance (L).** Left the pass-2 hidden-tab suspend in place (it is why a
  backgrounded automation tab shows a black map — not a regression). The army-panel
  cache-key narrowing above is a real per-frame win while a stack is selected.

## Foreground QA (Chrome, logged in as the repo's `qa-combat` seat on Finland)

Verified working: Continue (no blue flash) · political view default · portrait cards
(INFANTRY ×4 / ENGINEERS ×2 render) · command strip look · command tooltip
("Move — locked in combat · KEY M") · province Build row with 0 A.D. facility icons ·
graphics selector + enriched blurbs + Ultra render-scale readout · now-playing shows the
real track ("Land Between the Two Seas") · all three services healthy, no console errors,
save never archived.

## What was NOT finished / deferred

- **H — coastline black squares: applied, not visually confirmed at the artifact's zoom.**
  The shoreline is clean at strategic zoom, but the Chrome automation would not drive the
  map to the close chunk-seam zoom where the Ultra artifact actually appears (wheel-zoom
  events weren't taking on the canvas). The band change is conservative and low-risk;
  it still needs a human close-up look at an Ultra coastline to sign off.
- **G (graph half) — roads into water / trivial road clutter / road blur.** Needs a world
  rebuild (`build:world` → new worldHash → the running campaign gets archived). Not done
  by design. Would be a separate, explicitly-flagged pass with a fresh `data/` backup.
- **Exact army↔road width match (I).** 1.7 is a measured-ish step toward `ROAD_WIDTH`, not
  a foreground-verified match; the painted road on terrain is a touch wider than the 1.2
  geometry. Fine-tune with a close-up.
- **Formation looseness (G8).** Left the pass-2 march-column / rest-clump logic alone —
  changing the spread math is risky without a close-up to judge it against.
- **M — multi-campaign.** Untouched. New Campaign is still the honest "preview only, one
  campaign at a time" flow from pass 2. Progressing toward max-3 campaigns is a
  server-persistence change (`GameRegistry`, per-id game files) — the brief says only
  after fog is stable, and it can't be done safely without touching the save layer.
- **N — full fog of war.** Untouched (out of scope for this pass, same as pass 2). No
  hidden-info regression: the pass-2 contact gate and `?`-only foreign counters are intact.
- **Combats did not fire a fresh notification during QA** (the QA stack's fight predates
  this session), so the new combat-toast halo is verified by CSS/markup, not a live toast.

## Deliverable answers

1. **READY TO PLAY URL** — http://127.0.0.1:5173/  (log in, then Continue)
2. **Service health**

   | Service | Port | State |
   |---|---|---|
   | client (Vite) | 5173 | healthy |
   | auth-server | 3001 | healthy |
   | game-server (`world-at-war-2`) | 3002 | healthy, campaign advancing, save not archived |

   Note: `npm run game:dev` runs `build:world` first and it fails with `EPERM` while Vite
   holds `public/world` (the known Windows gotcha). The world is already built and
   deterministic (`git status public/world` clean), so the server is running via
   `npx tsx watch apps/game-server/src/main.ts` directly — no rebuild, no risk.
3. **Branch** — `fix/playtest-pass-3`
4. **Head commit** — `c69c135` (docs commit lands on top when this file is committed)
5. **Commits** — see the table above (5 code + 1 docs)
6. **Implemented** — Priority 1 in full (portraits, command strip, city/build icons);
   Priority 3 in full (movement pace, dev sim-speed, combat glow, notification polish,
   graphics-blurb/verify); Priority 2 renderer-side (coastline band, army scale). See lists.
7. **Not finished** — coastline visual sign-off, G graph-editing half, multi-campaign,
   full fog, formation-spread tuning. See "not finished".
8. **0 A.D. icons/assets visibly used?** — YES. The Build row (Barracks / Tank Plant /
   Ordnance Workshop) now renders the vendored 0 A.D. facility icons; command strip still
   uses the 0 A.D. attack/stop/split art from pass 2; resource + stat icons unchanged.
9. **Call of War-style / unit images visibly used?** — Style and card layout: YES — the
   composition strip is now image-first portrait cards in the Call of War register.
   Their actual images: NO, and deliberately — vendoring Bytro's copyrighted unit renders
   into the repo isn't defensible, so the seven portraits are original WW2-style vector
   art in a faction-neutral field-grey palette. Militia / motorised / mechanised /
   commandos / paratroopers from the reference table have no portrait because they are
   **not in the roster** (`unit-catalog.ts` has six types) — adding them would be a fake
   affordance.
10. **Existing campaign/save intact?** — YES. worldHash unchanged (`2fd320d5…de76f`), no
    new archive file, `data/game.json` only mutated by the running server advancing the
    live campaign, pre-work backup at `ironfronts-backups/pre-pass3-20260901-160757/`.
11. **Merge?** — **Not yet.** The code is green and the campaign is safe, but H (coastline)
    still needs a human Ultra close-up and the map/road items in Priority 2's second half
    are untouched. Play it on `fix/playtest-pass-3`, confirm the shoreline looks right and
    the portraits/commands feel good, then merge (or ask for a follow-up pass for the
    world-rebuild items first).
