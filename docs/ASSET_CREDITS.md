# Third-party asset credits

Ironfronts bundles a small number of third-party UI assets. Each is listed
below with its upstream project, exact source path, and licence. Only the
specific files we actually use are vendored.

## User-provided infantry model

`public/models/infantry.glb` is generated from the project owner's supplied
Saluting Soldier GLB exports. It contains the shared mesh, armature, texture,
and only the `Walking`, `Injured_Walk`, and `Injured_Walk_Backward` clips used
by the game. Run `npm run build:infantry-model` to regenerate it from the
source exports in the repository root. The supplied model is treated as an
Ironfronts project asset; confirm its original author/licence before public
distribution.

## User-provided tank models

`public/models/tank-light.glb` and `public/models/tank-medium.glb` are
converted from the project owner's supplied "Animated Tank Pack" FBX exports
(`Tank_Pack_Light.fbx`, `Tank_Pack_Medium.fbx` in the repository root; two of
the four hull designs in the source pack, picked for a lighter vs. heavier
silhouette). Each contains the shared hull/track mesh, the 89-bone armature,
and all four driving clips (`Tank_Forward`, `Tank_Backwards`,
`Tank_TurningLeft`, `Tank_TurningRight`); only Forward and Backwards are
currently wired into the game (see `src/tank-model.ts`). Run
`npm run build:tank-model` to regenerate them via headless Blender — set
`BLENDER_BIN` if Blender isn't in one of the default install locations. The
supplied models are treated as Ironfronts project assets; confirm their
original author/licence before public distribution.

---

## 0 A.D. — session UI icons

**Project:** 0 A.D. (Wildfire Games) — <https://github.com/0ad/0ad>
**Licence:** CC BY-SA 3.0 (0 A.D. art assets) —
<https://creativecommons.org/licenses/by-sa/3.0/>
**Attribution:** © Wildfire Games and 0 A.D. contributors.

Vendored under `src/ui/assets/icons/0ad/` (bundled by Vite). Each file is
copied unmodified from `0ad/0ad` at ref `master`, from
`binaries/data/mods/public/art/textures/ui/session/icons/`. The
`binaries/data/mods/*/art` tree is CC BY-SA 3.0 per that repo's
`binaries/data/mods/public/art/LICENSE.txt` and top-level `LICENSE.txt`.

| Vendored file | Upstream source path | Used in Ironfronts for |
|---|---|---|
| `food.png` | `resources/food.png` | Food resource |
| `metal.png` | `resources/metal.png` | Metal resource · metal-ore map marker |
| `stone.png` | `resources/stone.png` | Stone/rock deposit map marker |
| `wood.png` | `resources/wood.png` | (reserved — forestry) |
| `population.png` | `resources/population.png` | Manpower resource |
| `economics.png` | `economics.png` | Funds resource · Economy dock button |
| `production.png` | `production.png` | Industry resource · Tank-plant facility chip |
| `training.png` | `training.png` | Barracks facility chip (city panel) |
| `construction.png` | `construction.png` | Ordnance-works facility chip (city panel) |
| `diplomacy.png` | `diplomacy.png` | Diplomacy map mode · Diplomacy dock button |
| `objectives.png` | `objectives.png` | Objectives dock button |
| `attack-request.png` | `attack-request.png` | Attack-order request marker |
| `repair.png` | `repair.png` | Build / repair actions |
| `stop.png` | `stop.png` | Army stop order (command grid) |
| `kill.png` | `kill.png` | Attack command (command grid) |
| `patrol.png` | `patrol.png` | Patrol command (reserved) |
| `garrison.png` | `garrison.png` | Garrison command (reserved) |
| `heal.png` | `heal.png` | Health / medical stat |
| `promote.png` | `promote.png` | Veterancy / promotion (reserved) |
| `upgrade.png` | `upgrade.png` | Upgrade action (reserved) |
| `cancel.png` | `cancel.png` | Cancel / abort action (reserved) |
| `groups.png` | `groups.png` | Control-group / army-group UI (reserved) |
| `call-to-arms.png` | `call-to-arms.png` | Mobilise / call-to-arms (reserved) |
| `focus-attacked.png` | `focus-attacked.png` | "Force under attack" notification + click-to-focus |
| `focus-rally.png` | `focus-rally.png` | Rally-point indicator (province card) |
| `stances/aggressive.png` | `stances/aggressive.png` | Army stance: aggressive (reserved) |
| `stances/defensive.png` | `stances/defensive.png` | Army stance: defensive (reserved) |
| `stances/passive.png` | `stances/passive.png` | Army stance: passive (reserved) |
| `stances/standground.png` | `stances/standground.png` | Army stance: hold ground (reserved) |
| `ranks/Basic.png` | `ranks/Basic.png` | Army experience tier: green |
| `ranks/Advanced.png` | `ranks/Advanced.png` | Army experience tier: seasoned |
| `ranks/Elite.png` | `ranks/Elite.png` | Army experience tier: elite |
| `formations/column_open.png` | `formations/column_open.png` | Formation: march column (reserved) |
| `formations/line_closed.png` | `formations/line_closed.png` | Formation: firing line (reserved) |
| `formations/wedge.png` | `formations/wedge.png` | Formation: wedge / spearhead (reserved) |
| `formations/flank.png` | `formations/flank.png` | Formation: flanking (reserved) |
| `formations/box.png` | `formations/box.png` | Formation: defensive box (reserved) |
| `formations/scatter.png` | `formations/scatter.png` | Formation: dispersed (reserved) |

CC BY-SA 3.0 is share-alike: these icons remain under CC BY-SA 3.0 as
distributed here. If Ironfronts ships a formal credits screen, these must be
listed there too.

---

## 0 A.D. — session cursors

Vendored under `public/cursors/` (served as-is), copied unmodified from
`0ad/0ad` at `master`, `binaries/data/mods/public/art/textures/cursors/`.
Same CC BY-SA 3.0 art licence. Hotspot (x y, from the upstream `.txt`
sidecar) noted for the CSS `cursor: url(...) x y` fallback.

| Vendored file | Upstream source path | Hotspot | Used in Ironfronts for |
|---|---|---|---|
| `action-attack.png` | `cursors/action-attack.png` | 1 1 | Cursor over a valid attack target |
| `action-attack-move.png` | `cursors/action-attack-move.png` | 1 1 | Cursor for attack-move (reserved) |
| `action-capture.png` | `cursors/action-capture.png` | 1 1 | Cursor over a capturable province (reserved) |
| `action-garrison.png` | `cursors/action-garrison.png` | 1 1 | Cursor over a garrisonable target (reserved) |
| `cursor-rally.png` | `cursors/cursor-rally.png` | 5 31 | Cursor while placing a rally point |
| `cursor-no.png` | `cursors/cursor-no.png` | 13 14 | Cursor over an invalid / disallowed target |

---

## 0 A.D. — interface audio

Vendored under `public/audio/sfx/`, copied unmodified from `0ad/0ad` at
`master`, `binaries/data/mods/public/audio/interface/alarm/`. The
`binaries/data/mods/*/audio` tree is CC BY-SA 3.0 per that repo's
`binaries/data/mods/public/audio/LICENSE.txt` and top-level `LICENSE.txt`.

| Vendored file | Upstream source path | Used in Ironfronts for |
|---|---|---|
| `alarmattackunit_1.ogg` | `audio/interface/alarm/alarmattackunit_1.ogg` | "One of your forces is under attack" alert cue |

---

## flag-icons — country flag SVGs

**Project:** flag-icons (Panayiotis Lipiridis / contributors) —
<https://github.com/lipis/flag-icons>
**Licence:** MIT.

Vendored under `src/ui/assets/flags/` (bundled by Vite), copied unmodified
from `lipis/flag-icons` at ref `main`, path `flags/4x3/<code>.svg`.

Codes vendored: `at be bg ch cz de dk eg es et fi fr gb gr ie ir is it jp
lu nl no nz pl pt ro sa se tr za`.

**Historical accuracy:** `src/ui/flags.ts` maps each in-game country to a
**September 1939** flag. Where a nation's flag is unchanged since 1939 (plain
tricolours, Nordic crosses, the Hinomaru, the Union Jack) the flag-icons file
above is used directly. Where it differs, a period flag is vendored from
Wikimedia Commons — see the next section and `docs/flags.md`. The leftover
modern flag-icons files (`it.svg`, `gr.svg`, …) stay vendored only as
fallbacks and are not referenced for those countries. Germany is a deliberate
exception: it maps to the modern `de.svg`, not a period one — see
`docs/flags.md`.

---

## Historical national flags — Wikimedia Commons

**Source:** Wikimedia Commons, retrieved 2026-08-30 via
`commons.wikimedia.org/wiki/Special:FilePath/`.
**Licence:** Public domain (PD-old — pre-1929 designs and/or expired government
works). Each file carries its source URL and licence in a leading XML comment.

Vendored under `src/ui/assets/flags/`, unmodified:
`it-1861-1946` (Kingdom of Italy), `su-1936-1955` (USSR),
`gr-1935-1970` (Greece, royalist land flag), `yu-1918-1941` (Kingdom of
Yugoslavia), `eg-1922-1958` (Kingdom of Egypt), `iq-1921-1959` (Kingdom of
Iraq), `ir-1925-1979` (Imperial Persia, Lion and Sun),
`za-1928-1994` (Union of South Africa), `et-empire` (Ethiopian Empire),
`cn-roc` (Republic of China), `manchukuo` (Manchukuo).

Full per-entity rationale, colony→metropole mapping and known gaps: `docs/flags.md`.

---

## Original Ironfronts icons

`src/ui/assets/icons/ironfronts/` — authored for this project (same licence
as the Ironfronts repository). Used where no suitable 0 A.D. artwork exists:
`oil.svg` (Oil resource), `strategic.svg` / `political.svg` / `terrain.svg`
(map modes), `pickaxe.svg` (resource overlay toggle), `provinces.svg`,
`event.svg`, `close.svg`, `focus.svg`.

### Painted WW2 RTS button icons

**Source:** Original Ironfronts assets prepared on 2026-09-08. The four unit
buttons are 256 px derivatives of the established Ironfronts unit portraits
listed below. The building and command illustrations were generated with
OpenAI's built-in image generator. They are not copied from 0 A.D., Call of
War, or another third party and carry the same licence as this repository.

**Prompt direction:** realistic historical-strategy illustration on true
transparent alpha; hand-painted gouache and opaque watercolor, believable
WW2 construction and proportions, strong silhouettes, muted olive/khaki/
gunmetal/brick colors, visible brushwork, and softly broken edges. Command
prompts requested sober military objects and field-map marks. Building prompts
requested ground-level wartime architecture rather than toy-like isometric
facilities. Their selected silhouettes use infantry and rifle racks for the
barracks, an emerging tank for the tank plant, and a field gun plus shells for
the ordnance works so each remains identifiable at 64 px. Every prompt
prohibited text, frames, badges, glossy gold, thick
cartoon outlines, and mobile-game rendering. The direction was informed by
the official [0 A.D. icon showcase](https://play0ad.com/team-blog-icon-showcase/)
and the role clarity of the official [Call of War unit roster](https://wiki.callofwar.com/wiki/UNITS/),
without using either game's artwork as generator input.

**Modification:** the 320 px portrait derivatives and 1254-1536 px generator
outputs were high-quality bicubic downscaled without changing aspect ratio,
centered on 256x256 transparent RGBA canvases for runtime use.

| Runtime file | Slot |
|---|---|
| `src/ui/assets/icons/ironfronts/unit-engineer-icon.png` | Engineer production button |
| `src/ui/assets/icons/ironfronts/unit-armored-car-icon.png` | Armored-car production button |
| `src/ui/assets/icons/ironfronts/unit-light-tank-icon.png` | Light-tank production button |
| `src/ui/assets/icons/ironfronts/unit-medium-tank-icon.png` | Medium-tank production button |
| `src/ui/assets/icons/ironfronts/unit-artillery-icon.png` | Generated artillery production button |
| `src/ui/assets/icons/ironfronts/structure-barracks-icon.png` | Barracks build button |
| `src/ui/assets/icons/ironfronts/structure-tank-plant-icon.png` | Tank-plant build button |
| `src/ui/assets/icons/ironfronts/structure-ordnance-icon.png` | Ordnance-works build button |
| `src/ui/assets/icons/ironfronts/command-move.png` | Move command |
| `src/ui/assets/icons/ironfronts/command-attack.png` | Attack command |
| `src/ui/assets/icons/ironfronts/command-retreat.png` | Retreat command |
| `src/ui/assets/icons/ironfronts/command-split.png` | Split command |
| `src/ui/assets/icons/ironfronts/command-stop.png` | Stop command |
| `src/ui/assets/icons/ironfronts/command-extract.png` | Extract command |

### Strategic army-counter art

**Source:** Original Ironfronts assets generated with OpenAI's built-in image
generator on 2026-09-08 and prepared for this project. They are not copied from
0 A.D., Call of War, or any other third party and carry the same licence as the
Ironfronts repository.

**Backplate prompt direction:** a compact front-facing WW2 military map counter
made from worn gunmetal and field-green enamel, aged brass rim, a recessed
condition channel, restrained hand-painted texture, no unit symbol, no number,
no text, no insignia, no glossy mobile-game rendering, and a genuinely
transparent exterior.

**Silhouette prompt direction:** one historically plausible WW2 unit per image,
side/profile view with realistic proportions and a strong field-manual stencil
outline. The six subjects were an infantry rifleman, combat engineer with
entrenching tool, armoured reconnaissance car, light tank, medium tank, and
towed field gun. Bone paint and charcoal line work only; no badges, labels,
frames, scenery, modern equipment, exaggerated cartoon shapes, or watermark.

**Modification:** four generator outputs contained a rendered transparency
checker. `scripts/prepare-army-marker-silhouettes.mjs` separates warm bone paint
and charcoal line work from that neutral checker, retains the connected subject,
and Lanczos-downscales each result to a true-alpha 96x96 stencil. The six
individual sprites are packed into a 576x96 runtime atlas in exact shader order.
The painted surface stays separate from live silhouettes, per-type amounts,
owner colour, condition, selection, engagement, and fog-of-war state.

| Runtime file | Slot |
|---|---|
| `src/ui/assets/army-marker-plate.png` | Original counter reference; superseded in runtime by the irregular cartouche |
| `src/ui/assets/army-unit-silhouettes.png` | Six-cell WebGPU silhouette atlas |
| `src/ui/assets/icons/ironfronts/marker-infantry.png` | Infantry counter silhouette |
| `src/ui/assets/icons/ironfronts/marker-engineer.png` | Engineer counter silhouette |
| `src/ui/assets/icons/ironfronts/marker-armored-car.png` | Armoured-car counter silhouette |
| `src/ui/assets/icons/ironfronts/marker-light-tank.png` | Light-tank counter silhouette |
| `src/ui/assets/icons/ironfronts/marker-medium-tank.png` | Medium-tank counter silhouette |
| `src/ui/assets/icons/ironfronts/marker-artillery.png` | Artillery counter silhouette |

### Irregular field-command UI skins

**Source:** Original Ironfronts assets generated with OpenAI's built-in image
generator on 2026-09-09. The existing Ironfronts counter plate was supplied as
a material/palette reference only. No 0 A.D. or Call of War artwork was copied.

**Direction:** replace generic square UI fills with readable, genuinely
transparent, hand-painted field-command objects: a winged army cartouche, a
vertical composition shield, an arched unit-card frame, a scalable stitched
panel surround, a wide control medallion, a dedicated building plaque, a
production-queue slot, and a low action ribbon. All use
soot iron, chipped field-green enamel or leather, oxidised brass, bone edge
wear, realistic 1930s-1940s proportions, and restrained historical-RTS craft.
Every prompt explicitly excluded text, numbers, icons, flags, insignia, logos,
watermarks, scenery, square corners, glossy mobile-game rendering, and fantasy
ornament.

**Generated sources:**

- `exec-52885de1-2ef3-4dec-8ec5-352c5806fb20.png` - army cartouche
- `exec-9f73864b-dfa3-4fd8-97ad-51137d79d9aa.png` - composition shield
- `exec-d6f164ac-4bdf-470e-bb5e-de7f1250c41e.png` - unit-card arch
- `exec-01b68991-c78b-4387-a7b0-23590d4453e9.png` - campaign panel surround
- `exec-8bfa0afb-bffe-4498-a978-406d6b26174f.png` - control medallion
- `exec-f815f73e-a9ed-4b8a-9ea7-eec9234696ea.png` - action ribbon
- `exec-4bad58e0-37f9-40e3-aee6-447bdcb04917.png` - wide command medallion, replacing the first near-square version
- `exec-fef80e54-e8a7-4ee8-bfb8-167274894fce.png` - tapered roster shield, replacing the first boxier version
- `exec-b3c75fed-08ad-4d6b-a92a-04304568dce4.png` - building / production plaque
- `exec-8c7fd6cd-6815-4ffe-b0f1-84bc992e05c8.png` - production-queue portrait slot

Sources are retained under
`C:\Users\dimah\.codex\generated_images\01a07cbe-934b-7b62-bd93-3bfc096b5146`.
`scripts/prepare-generated-ui-skins.mjs` alpha-trims and premultiplied-alpha
Lanczos-downscales them without changing their aspect. It also derives the
enclosed alpha mask used by the arched unit cards.

| Runtime file | Use |
|---|---|
| `src/ui/assets/skins/army-counter-cartouche.png` | WebGPU strategic army counter and DOM fallback |
| `src/ui/assets/skins/army-roster-plaque.png` | WebGPU close-zoom six-type composition roster |
| `src/ui/assets/skins/army-unit-card-frame.png` | Arched army-detail portrait surround |
| `src/ui/assets/skins/army-unit-card-mask.png` | Generated outer silhouette for portrait-card clipping |
| `src/ui/assets/skins/hud-panel-frame.png` | Nine-slice top bar, panels, notices, and dialogs |
| `src/ui/assets/skins/hud-control-plate.png` | Wide fixed-aspect command and icon controls |
| `src/ui/assets/skins/hud-building-plaque.png` | Larger facility and unit-production controls |
| `src/ui/assets/skins/hud-queue-slot.png` | Unit and construction queue portraits with a progress groove |
| `src/ui/assets/skins/hud-action-ribbon.png` | Nine-slice text actions, status rows, and tooltips |

### War-room menu repair kit

**Source:** Original Ironfronts assets generated with OpenAI's built-in image
generator on 2026-09-09. They replace low-resolution source-sheet crops that
were stretched or screen-blended at runtime. No third-party game artwork was
used.

**Direction:** clean transparent 1930s-1940s dossier hardware with the same
blackened iron, worn field green, old brass, and restrained paper wear as the
in-game command surfaces. The set contains a scalable equipment rail, a torn
cloth-and-paper map surround with an open centre, one corner fastener, a brass
compass rose, and a faint repeatable plotting grid. Prompts excluded text,
labels, scenery, black crop backgrounds, checkerboards, glossy rendering, and
fantasy ornament.

**Generated sources:**

- `exec-b9bd8f77-f09d-4434-bb94-28ed4cc8d921.png` - dossier edge rail
- `exec-5b9107af-4efb-49db-a1b7-78aa34a69e18.png` - torn map surround
- `exec-49302bf2-c5ff-416c-8900-b86b1437926a.png` - corner fastener
- `exec-164b274e-bc51-44a7-a308-681b5e63f146.png` - compass rose
- `exec-3d0195c7-cefd-4718-ac3e-6ed4aeaf8e5b.png` - plotting grid

`scripts/prepare-generated-ui-skins.mjs` alpha-trims and premultiplied-alpha
resizes this set into `public/menu/kit`. Its `--despill-red-edges` mode removes
the generator's semi-transparent red edge matte without changing opaque brass
or paper. CSS uses nine-slice framing and repeatable overlays rather than
stretching the whole source image.

| Runtime file | Use |
|---|---|
| `public/menu/kit/edge-strip.png` | Nine-sliced dossier top/bottom equipment rail |
| `public/menu/kit/torn-paper-frame.png` | Nine-sliced campaign-map surround |
| `public/menu/kit/corner-fastener.png` | Dossier corner hardware |
| `public/menu/kit/compass-marker.png` | Campaign-map compass overlay |
| `public/menu/kit/map-grid.png` | Repeating transparent plotting grid |

### `public/ui/diplomatic-cable-watermark.png`

Original Ironfronts project artwork generated with OpenAI's built-in image
generation tool on 2026-09-07. The prompt requested a transparent, distressed
two-colour 1939 field-envelope and radio-arc watermark in the HUD's brass and
cream palette. Used decoratively in the diplomacy drawer header; no control or
game state depends on the image.

### `water.png`

**Source: User-provided Ironfronts asset.** A painterly water-drop-in-a-bowl
raster supplied by the project owner for the `water` / `resource-water` icon
slot (`src/ui/icons.ts`). It is **not** from 0 A.D. or any other third party
and carries the same licence as the Ironfronts repository.

**Modification:** the supplied 1254×1254 source (~1 MB) was box-downsampled to
128×128 (~16 KB) for runtime — it is only ever drawn as a ~14–24 px icon.
Regenerate from the original with `scripts/`-style tooling if a larger size is
ever needed.

### Painterly unit portraits & facility / stance art

**Source: User-provided Ironfronts assets.** Painterly WW2 unit portraits,
facility building art and order-stance emblems generated by the project owner
(OpenAI image tool) for Ironfronts. Not from 0 A.D. or any other third party;
same licence as the Ironfronts repository.

**Modification:** each ~1240 px, ~1.7 MB source PNG was alpha-trimmed and
Lanczos-downscaled with Pillow — portraits to 384 px, icons to 256 px
(90–210 KB each). Regenerate larger from the originals if ever needed.

| Runtime file | Slot | Wired? |
|---|---|---|
| `src/ui/assets/units/infantry.png` | Infantry composition portrait | yes (raster beats the SVG) |
| `src/ui/assets/units/engineer.png` | Engineer / pioneer portrait | yes |
| `src/ui/assets/units/armored-car.png` | Armoured-car portrait | yes |
| `src/ui/assets/units/light-tank.png` | Light-tank portrait | yes |
| `src/ui/assets/units/medium-tank.png` | Medium-tank portrait | yes |
| `src/ui/assets/units/artillery.png` | Artillery portrait | yes |
| `src/ui/assets/icons/ironfronts/barracks.png` | Detailed barracks art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/tank-plant.png` | Detailed tank-plant art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/ordnance.png` | Detailed ordnance art | legacy; replaced in Build row by the compact generated icon above |
| `src/ui/assets/icons/ironfronts/fortress.png` | `structure-fortress` | reserved — no fortress building exists yet |
| `src/ui/assets/icons/ironfronts/settlement.png` | `structure-city` (walled town) | reserved — no city/settlement icon slot yet |
| `src/ui/assets/icons/ironfronts/stance-attack.png` | `stance-attack` (three swords) | yes — army-panel stance row (2026-09-12) |
| `src/ui/assets/icons/ironfronts/stance-attack-defend.png` | `stance-attack-defend` (crossed swords + shield) | yes — balanced/default stance |
| `src/ui/assets/icons/ironfronts/stance-defend.png` | `stance-defend` (shield + planted spears) | yes |
| `src/ui/assets/icons/ironfronts/stance-retreat.png` | `stance-retreat` (soldier + fall-back arrow) | yes |
| `src/ui/assets/icons/ironfronts/stance-defend-retreat.png` | `stance-defend-retreat` (double shield + fall-back arrow) | yes |

---

## Sourcing lead: better close-LOD building models (not yet integrated)

**Status: procedural variety improved (2026-09-12); real sourced 3D models
still not integrated.** `src/scene-meshes.ts`'s `createBuildingArchetypeMesh`
previously gave all 5 building archetypes the *same* footprint and height,
varying only roof shape — from the game's high strategic camera, roof shape
alone reads as near-identical boxes. Each archetype now has a genuinely
different footprint, height, and roofline (small cottage, tall townhouse,
wide low shop/warehouse, larger building with a porch, and a landmark
archetype redesigned from a thin spire into a wide civic-building base with
a modest clock-tower flourish so it reads as an imposing capital building
rather than just "the tall one"), verified visually in a live session at
both day and night lighting. This is a same-session, zero-risk change (pure
client-side mesh generation, no world rebuild, no new asset pipeline) — it
does not touch `scripts/build-world.mjs`'s per-instance archetype/scale
assignment, which is a separate, riskier surface (a world rebuild there was
what caused the coastal resource-node drift repaired this session — see the
game.json backups in `data/`).

Two things worth knowing if this gets touched again:
- **Footprint ceiling.** `scripts/world/instances.mjs`'s `ARCHETYPE_FOOTPRINT_HALF`
  bakes in an assumed footprint half-extent per archetype for its coastal
  water-clearance check, run once at world-build time against the *already
  baked* `data/game.json`/`public/world` — going wider than that without also
  rebuilding the world risks a building's corner rendering into open water at
  some unlucky coastal placements (archetype 2 briefly did before being
  trimmed back; see the comments in `createBuildingArchetypeMesh`). Archetype
  4 has a generous 3.0-world-unit safety margin there and can safely go
  wider; the others have only a 0.75-unit margin.
- **Material index is not decorative — it's a visibility switch.** The
  fragment shader in `src/shaders/props.ts` hides materials 2/3/4/5 for every
  archetype except the one each is hardcoded to (porch=3-only-for-3,
  tower=4-only-for-4, hip-roof=4-only-for-1(!), flat-roof=5-only-for-2), and
  additionally hides material 1 (gable roof) specifically for archetypes 1
  and 2. Using the wrong material index for an archetype doesn't error — the
  geometry just renders invisible. `tests/building-archetype-materials.test.ts`
  is a GPU-free regression test against exactly this mistake (which this
  session nearly shipped while widening the landmark archetype).

Replacing the procedural boxes with real sourced 3D models is a larger,
separate task that needs a renderer integration pass with working visual
verification, which was intermittently unavailable this session (Chrome
DevTools Protocol screenshot capture was flaky/timing out for stretches, for
reasons unrelated to this codebase) — left for whenever that's reliably
available.

### Original lead (2026-08-26 abandoned branch)

An abandoned `feature/in-game-ui-world-polish` branch (superseded by later
painterly-art and simulation-refactor work — see `HANDOFF.md`) had wired a
close-LOD building loader against Kenney's CC0 "City Kit (Suburban)",
mirrored at <https://github.com/petroulacl/fps-buildings-env-kit>
(`buildings/kenney-city-kit-suburban/`). The old loader
(`src/external-models.ts` in that commit history, now gone from `main`)
fetched five `.obj` variants from that mirror at runtime. Superseded by the
survey below — Kenney's kit turned out not to be the best style fit anyway
(see "Style fit is the real bottleneck").

### Sourcing survey (2026-09-12)

Searched for a ready-made, licence-clean, low-poly building kit to replace
the procedural boxes above. Style fit turned out to be the real obstacle,
not availability — most freely-licensed, batch-ready building kits are built
for cheerful city-builders, not somber 1930s-40s war games, and the ones
with a better tonal fit have licence terms too vague to vendor into this
(public) repo. None of the following were vendored; this is a survey to
save the next pass from re-treading the same searches.

**Purpose-built low-poly kits (technically ideal, wrong tone) — confirmed CC0:**
- Kenney "City Kit (Suburban)" v2 — <https://kenney.nl/assets/city-kit-suburban> — CC0,
  but the current v2 release ("completely remade") no longer matches the
  filenames (`building-type-{a,g,i,q,t}.obj`) the 2026-08-26 branch fetched
  from the GitHub mirror above, so that specific integration path is stale
  regardless. Visual style reads as cartoonish/stylized, not war-appropriate.
- Quaternius "LowPoly Buildings Pack" (aka Ultimate Textured Building Pack) —
  <https://opengameart.org/content/lowpoly-buildings-pack> — CC0, FBX/OBJ/Blend,
  modular with swappable palettes. Style is explicitly "Earthbound-inspired"
  (cute, colourful SNES-JRPG look) — a poor fit.

**Best style fit found — licence too vague to vendor as-is:**
- "Industrial Low Poly City" by Voloshka —
  <https://viravoloshyn.itch.io/low-poly-city-asset-pack> — 526 free modular
  FBX prefabs (walls, doors, windows, roofs) in 10 palettes including
  **Khaki, Charcoal, Steel Blue, Navy** — genuinely muted/industrial, not
  cartoonish, and even ships lit/unlit/partially-lit window variants that
  would slot straight into this game's existing night-window emissive
  system. The page states prefabs are "100% free to download and use in
  your personal or commercial projects" but never says CC0 or addresses
  redistributing the raw source files (as opposed to using them inside a
  built game) — not the same guarantee as this file's other CC0/CC-BY
  entries. **Before vendoring: message the creator (itch.io has a built-in
  contact/comment system) asking explicitly whether the free files may be
  committed to a public source repository, and get that in writing before
  adding files here.** If confirmed, this is the strongest candidate found.

**War-thematic props (not town buildings, but worth remembering) — no usable licence found:**
- "3D Trench Warfare Low Poly" by nuclearwinter94 —
  <https://nuclearwinter94.itch.io/tre> — bunker, trench sections, sandbags,
  barbed wire, Czech hedgehogs, in `.obj`/`.fbx`/`.glb`/`.blend`, explicitly
  aimed at "strategy games, historical simulations." **No licence text of any
  kind on the page** — under default copyright this is not usable without
  contacting the creator, however good the fit.

**Confirmed CC0 but the wrong kind of content:**
- "LowPoly Modular Assets" (bunker interior) by Nailfighter —
  <https://nailfighter.itch.io/low-poly-bunker-modular-assets> — explicitly
  linked CC0 v1.0 Universal license, FBX, muted industrial style. Contents
  are bunker-interior primitives (brick wall sections in two sizes, a door,
  a pillar, crates, tiles) rather than complete exterior town buildings —
  possibly useful as raw material to compose simple exteriors from (same
  spirit as this project's own procedural `MeshBuilder` boxes-and-roofs
  approach), but that's a modelling exercise, not a drop-in replacement.
- Poly Haven (<https://polyhaven.com>) — the one unambiguously-CC0-everything
  source checked — has no building/structure models at all; it's a
  photoreal PBR prop/texture/HDRI library, not a game-ready building kit.

**Recommendation for whoever picks this up:** contact Voloshka about
redistribution terms first — it's the only candidate that is both licensable
(pending confirmation) and stylistically right. If that falls through, the
Nailfighter CC0 primitives are the fallback raw material, at the cost of
someone doing real modelling work to assemble them into buildings. Either
path is a genuinely separate task from the procedural-geometry tuning above:
it needs an FBX or OBJ import path (neither exists in the client today — the
2026-08-26 branch's OBJ parser was deleted), a way to feed imported geometry
into the same instanced-rendering pipeline `scene-meshes.ts`/`props.ts`
currently drive from pure code, and a live-browser verification pass.
