# Nation flags (September 1939)

Ironfronts resolves a flag per in-game country through `src/ui/flags.ts`
(`resolveFlagUrl(name)` / `createFlag(...)`). This document records what art each
entity gets and why.

The game partitions the 1939 world into ~100 selectable "countries". Only some
are sovereign 1939 belligerents; many are fictional gameplay subdivisions
(US/Brazilian/Australian states, Soviet oblast-sized regions, Chinese warlord
cliques) that never had a national flag. Every unmapped entity renders a **colour
standard** (a plain chit tinted with the country colour) — a deliberate scenario
fallback, never an invented or anachronistic flag.

## Resolution rules

| Entity kind | Flag shown |
|---|---|
| Sovereign belligerent | Its own 1939 flag |
| Real colony / mandate / protectorate | Flag of the power that administered it in 1939 |
| Fictional subdivision, or unresolved | Colour standard (`resolveFlagUrl` returns `null`) |

## Vendored period flags

All files below are in the **public domain** (PD-old: pre-1929 designs and/or
government works whose copyright has expired). Each is vendored verbatim from
Wikimedia Commons into `src/ui/assets/flags/` with a source + licence comment in
the file. Retrieved 2026-08-30 via `commons.wikimedia.org/wiki/Special:FilePath/`.

| File | Entity | Design / era | Commons source |
|---|---|---|---|
| `de-1935-1945.svg` | Germany | National flag 1935–1945 (red field, white disc, black swastika) | `File:Flag of Germany (1935–1945).svg` |
| `it-1861-1946.svg` | Italy, Libya | Kingdom of Italy tricolour with Savoy arms | `File:Flag of Italy (1861–1946).svg` |
| `su-1936-1955.svg` | (Soviet-territory entities, if mapped) | USSR state flag 1936–1955 | `File:Flag of the Soviet Union (1936–1955).svg` |
| `gr-1935-1970.svg` | Greece | Royalist land flag (blue field, white cross), restored 1935 | `File:Flag of Greece (1822–1978).svg` |
| `yu-1918-1941.svg` | Yugoslavia | Kingdom of Yugoslavia blue-white-red | `File:Flag of the Kingdom of Yugoslavia.svg` |
| `eg-1922-1958.svg` | Egypt | Kingdom of Egypt (green, crescent + 3 stars) | `File:Flag of Egypt (1922–1958).svg` |
| `iq-1921-1959.svg` | Iraq | Kingdom of Iraq 1921–1959 | `File:Flag of Iraq (1921–1959).svg` |
| `ir-1925-1979.svg` | Persia | Imperial state flag with Lion and Sun | `File:State Flag of Iran (1933-1964).svg` |
| `za-1928-1994.svg` | South Africa | Union of South Africa 1928–1994 ("oranje-blanje-blou") | `File:Flag of South Africa (1928–1994).svg` |
| `et-empire.svg` | Ethiopia | Ethiopian Empire, Lion of Judah | `File:Flag of Ethiopia (1897-1974).svg` |
| `cn-roc.svg` | Nationalist China | Republic of China, "Blue Sky with a White Sun" | `File:Flag of the Republic of China.svg` |
| `manchukuo.svg` | Manchukuo | Japanese puppet state 1932–1945 | `File:Flag of Manchukuo.svg` |

Unchanged since 1939 and already vendored as flag-icons (MIT — see
`ASSET_CREDITS.md`): `fi pl fr gb tr jp se nz sa pt be nl lu ch at dk no ie is bg cz`.
These are period-correct plain tricolours / Nordic crosses / the Hinomaru / the
Union Jack.

## Colonies → administering power (1939)

`France (fr)`: Algeria, Mauritania, French Sudan, Upper Volta, Equatorial Gabon,
Madagascar, Syria (mandate), Indochina.
`United Kingdom (gb)`: Nigeria, Bechuanaland, Tanganyika, Burma, "Pakistan",
North/South India, British Odisha, North/South Sudan (Anglo-Egyptian).
`Belgium (be)`: Belgian Congo. `Portugal (pt)`: Angola. `Italy`: Libya.

## Known gaps (fall back to colour standard or modern art)

| Entity | Current | Correct target, not yet vendored |
|---|---|---|
| Spain | modern `es.svg` | Nationalist state flag 1938–1945 (Commons file is a 500 KB detailed-eagle SVG; needs a lightweight redraw before vendoring) |
| Romania | modern `ro.svg` | 1922–1947 flag with royal coat of arms (plain civil tricolour is visually close; low priority) |
| Mongolia | colour standard | `File:Flag of the Mongolian People's Republic (1924–1940).svg` |
| Venezuela, Colombia, Peru, Bolivia | colour standard | modern tricolours are ~period-correct; add `ve/co/pe/bo` flag-icons files |
| Tibet, Communist China, warlord cliques (Ma-Clique, Sichuan, Xinjiang) | colour standard | flag usage genuinely disputed for 1939 — Codex flagged these for human review; leaving them as standards is the honest choice |
| Korea | colour standard | under Japanese rule; using the Hinomaru here is politically loaded — left unmapped deliberately |
| Philippines, Papua New Guinea | colour standard | Commonwealth of the Philippines flag / Australian flag — add if `ph`/`au` art is vendored |

## Research provenance

The entity categorisation (sovereign / colony / fictional) and candidate flags
were produced by a Codex (`gpt-5.3-codex`, medium effort, read-only) research
pass over the exact 102-entity list, then spot-checked against Wikimedia Commons
before vendoring. Notable corrections during review: Codex's Ethiopia and
Romania Commons links pointed at modern files; the period files above were used
instead. Codex's own low-confidence rows (Communist China, the cliques, Tibet,
Syria, Burma) are the gaps left unmapped above.
