# Europe map material

This directory contains the sanitized static map and opening ownership extracted from the repository-root `www.callofwar.com.har` by `node scripts/extract-europe-har.mjs`.

- Map ID: `23114_3`, version 38, 5,935 × 3,950 map units.
- 634 provinces, 665 sea points, 53 territorial countries and 4,969 exact movement connections.
- Static boundaries, detached components, centers, terrain markers, ownership, resource production and original triangulations are retained. `source/23114_3@high.original.json` is the static payload from the HAR.
- The captured opening state supplies province and sea labels, country names, colors and starting owners. Account identifiers, usernames, messages and live game state are excluded.
- This map has no region (`rg`) assignments. The matching region files are empty.

The build uses `MAP_KIND=europe node scripts/build-world.mjs` (or `npm run build:europe`) and writes `public/europe`. World remains the default map.
