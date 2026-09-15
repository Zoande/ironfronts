# Audio credits and licensing

Ironfronts uses music from the **0 A.D. soundtrack** by Wildfire Games and its music contributors.

## License

The official 0 A.D. music page states that the soundtrack is released under the
**Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)** license.

- Official soundtrack page: https://play0ad.com/media/music/
- License: https://creativecommons.org/licenses/by-sa/3.0/
- Official May 2015 MP3 archive:
  https://play0ad.com/wp-content/uploads/2015/06/0-AD-Music_updated_May2015.zip

The soundtrack assets remain under CC BY-SA 3.0. This notice does not relicense
Ironfronts source code.

When redistributing these tracks or adaptations of them, preserve attribution
and comply with the ShareAlike terms of CC BY-SA 3.0.

## Archive used for the Ironfronts soundtrack catalog

The supplied `0-AD-Music_updated_May2015.zip` contains:

- 31 MP3 tracks
- approximately 89.63 MiB total audio
- approximately 97.2 minutes total runtime
- archive SHA-256: `b04049a17fe33ff5ff87bf243dd81d4b2790e9d68e76f44cf459a1ce63407cea`
- 128 kbps MP3 for 30 tracks
- 160 kbps MP3 for `Cisalpine_Gaul.mp3`

The MP3 files only contain basic album/title ID3 metadata, so this document
preserves creator attribution separately.

## Primary music credits

The soundtrack is led by **Omri Lahav**. Known primary-artist exceptions and
collaborations in this 31-track set include:

- **Jeff Willet** — First Sighting; Elusive Predator
- **Mike Skalandunas** — Tavern in the Mist
- **Omri Lahav & Shlomi Nogay** — Valley of the Nile

0 A.D. release notes also credit Jeff Willet with percussion on Celtica and
The Hellespont, and credit additional performers on various recordings.

## Ironfronts music grouping

### Menu

- Calm Before the Storm
- Honor Bound

### Match opening

- First Sighting

### Relaxed / peace rotation

- Ammon-Ra
- An Old Warhorse Goes to Pasture
- Celtic Pride
- Celtica
- Cisalpine Gaul
- Dried Tears
- Eastern Dreams
- Elysian Fields
- Forging a City-State
- Harsh Lands, Rugged People
- Harvest Festival
- Highland Mist
- In the Shadow of Olympus
- Juno Protect You
- Land Between the Two Seas
- Mediterranean Waves
- Peaks of Atlas
- Sands of Time
- Tavern in the Mist
- The Hellespont
- The Road Ahead
- Valley of the Nile
- Water's Edge

> Ironfronts intentionally places **Dried Tears** in the relaxed rotation to
> follow the selected soundtrack design. In 0 A.D. it was historically used as
> a defeat cue.

### War / battle rotation

- Elusive Predator
- Helen Leaves Sparta
- Karmic Confluence
- Rise of Macedon

## Runtime source policy

During development, tracks that still exist in the archived public
`0ad/0ad` GitHub mirror are streamed from commit
`61a3b9507d974084e6badb88a0826bd89a6d5b8b` so playback is deterministic
and does not follow a moving branch.

The current archived mirror no longer contains **First Sighting** or
**Elusive Predator**. The music catalog therefore also supports same-origin
MP3 files under `public/audio/music/`. Once the May 2015 archive is vendored,
those two tracks (and optionally all tracks) should be served locally rather
than depending on an external mirror.

## Sound effects and ambience

### Kenney UI Audio — CC0 1.0

Ironfronts currently uses three UI samples from **Kenney's UI SFX Set**:

- `public/audio/sfx/ui-click.wav` — original `click1.wav`
- `public/audio/sfx/ui-hover.wav` — original `rollover2.wav`
- `public/audio/sfx/ui-switch.wav` — original `switch14.wav`

Original author: **Kenney Vleugels (Kenney.nl)**  
License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://kenney.nl/assets/ui-audio

The WAV copies were vendored from the CC0 mirror
`Calinou/kenney-ui-audio` at commit
`8c3d81b9159d058c444f89d12d518276b0b09345`. That mirror documents the
WAVs as lossless conversions of Kenney's original OGG files.

Attribution is not required by CC0, but is preserved here.

### Ylmir — Rain (loopable) — CC0 1.0

`public/audio/ambience/rain.ogg` is from **Rain (loopable)** by **Ylmir**,
published on OpenGameArt.org.

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/rain-loopable

The vendored file is the 45-second `3.ogg` variant from the original
`Rain OGG.zip` pack, re-encoded from 160 kbps to 96 kbps Vorbis with no
other modification. It was copied from
`halogenandtoast/ArkhamHorror` at commit
`7cca20a30a271a1386041a5381622ae46ab0f26d`, which preserves the original
source and CC0 license notice.

The rain loop is intentionally non-spatial: rainfall should surround the
listener rather than sound like a single point emitter. Directional events such
as thunder are routed separately and can use HRTF spatialization.

### Spring Spring — map/paper movement — CC0 1.0

The dossier movement now uses the two **Opening and Closing a Map Sounds**
recordings published by Spring Spring (Julie Damsgaard / Spring Enterprises):

- `public/audio/sfx/dossier-open.wav` — original `snd_use_map.wav`
- `public/audio/sfx/dossier-close.wav` — original `snd_close_map.wav`

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/opening-and-closing-a-map-sounds

The copies were vendored from `Brandon-Valley/NationalParkAfterDark` at
commit `3380da9e4bdcc86c52b70e36e205260f1139ba71`.

### Kenney Interface Sounds — order confirmation — CC0 1.0

`public/audio/sfx/order-confirm.wav` is Kenney's
`confirmation_002.wav` from the **Interface Sounds** pack.

Author: **Kenney Vleugels (Kenney.nl)**  
License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://kenney.nl/assets/interface-sounds

The file was vendored from `Calinou/kenney-interface-sounds` at commit
`4596a49eaf5a533948d49a47467f606bcdea70ff`.

Ironfronts layers a very quiet low-frequency generated thump underneath this
sample for the Begin/Resume/confirm action so an order feels mechanical and
weighty rather than like a generic web-button click.

### SketchMan3 — wind whoosh loop — CC0 1.0

`public/audio/ambience/wind.ogg` is **wind whoosh loop** by SketchMan3.

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/wind-whoosh-loop

The author describes it as a looped/EQ'd section of the CC0
`Loopable Dungeon Ambience` recording. The copy used here was vendored from
`pacsui/grapple_thing` at commit
`b659aacd272b09db090b0d53ee80a5102cbb2e45`.

Wind is a quiet non-spatial world bed and begins when the rendered world is
ready.

### jasinski / qubodup — coastal waves — CC0 1.0

`public/audio/ambience/ocean-waves.wav` is the first **Beach Ocean Waves**
recording by jasinski, submitted to OpenGameArt by qubodup. The source pack
contains four short beach-wave recordings and is published under CC0.

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/beach-ocean-waves

The WAV copy was vendored from `AdamSmif/Goonie-Golf` at commit
`d51cfa36096caf45fd1a7c161ca8ce61472e082a`, where it is stored as
`wave_01_cc0-18363__jasinski__alkaibeach.wav`. Its source blob SHA is
`f73ce52739ba332e01a2c0a6aa90bbdec2bdaafb`.

Ironfronts currently fades this coast recording in only when the camera target
is open water and the camera is below regional overview distance. A later
spatial pass can replace that binary trigger with distance-to-coast HRTF
emitters and a richer multi-wave bed.

### rubberduck — thunder — CC0 1.0

`public/audio/sfx/weather-thunder.ogg` is
`sfx100v2_thunder_01.ogg` from rubberduck's **100 CC0 SFX #2** pack.

License: **Creative Commons Zero (CC0 1.0 Universal)**  
Original source: https://opengameart.org/content/100-cc0-sfx-2

The file was vendored from `pegross/card-crafter` at commit
`82c11e0a3bae1fbd8ed741c00dba91d3afc078e6`.

Thunder is the first sampled effect routed through an HRTF `PannerNode`.
The weather diagnostics panel exposes a Thunder Preview button so headphone
users can verify the directional effect independently of the rain toggle.

