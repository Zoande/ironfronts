# Ironfronts

Hey! Ironfronts is an authoritative multiplayer grand-strategy prototype with a native WebGPU world renderer. It combines a persistent server simulation, account/country-seat flow, fog-filtered real-time replication, directional combat, and a deterministic offline compiler for a 3,303-province world.

## What is implemented

- Persistent single-world multiplayer simulation at 10 authoritative ticks per second
- Account registration/login with SQLite-backed HttpOnly sessions
- Permanent country selection and short-lived, single-use gameplay tickets
- Protocol-v3 WebSocket baselines, change-only deltas, resync, delivery-aware events, and revision acknowledgements
- Graph-based army movement, neutral-territory confirmation, pursuit, splitting, extraction, production, and construction
- Directional close combat with ten-unit frontage, continuous damage, armor-specific damage, retreats, and artillery bombardment
- Per-country fog-of-war projections and contact markers
- WebGPU terrain, water, infrastructure, cities/props, political overlays, labels, weather, armies, and diagnostics
- Deterministic world compiler with recoverable promotion and generation reports
- Structured game/auth logs, durable server state, and browser visual/performance tooling

## Architecture

The repository is an npm-workspace monorepo:

| Component | Role |
|---|---|
| `apps/client` + `src/client`, `src/ui`, `src/renderer*` | Browser login/menu, authoritative replica, HUD, audio, WebGPU presentation |
| `apps/auth-server` | Accounts, sessions, public lobby facade, gameplay-ticket issuance |
| `apps/game-server` | Country seats, commands, simulation, fog projections, game persistence |
| `packages/protocol` | Shared v3 gameplay schemas/types and ticket signing |
| `packages/game-core` + `src/game` | Browser-free authoritative rules and plain game state |
| `scripts/world`, `scripts/infrastructure` | Offline world compiler |
| `material` | Immutable source geometry/topology/movement/metadata |

Default local ports are client `5173`, auth `3001`, and game `3002`. The browser authenticates with the auth service, claims a country, receives a 30-second game ticket, then connects directly to the authoritative gameplay WebSocket. The game server sends only that country's filtered projection.

Read [Repository architecture](docs/architecture.md) for the complete ownership/data flow.

## Requirements

- Node.js 22+
- npm
- Current desktop Chrome or Edge with WebGPU and hardware acceleration

The auth server uses Node's built-in SQLite API. There is no WebGL renderer fallback.

## Local setup

Install dependencies:

```sh
npm install
```

Review `.env.example`. Vite reads `VITE_*` values from its environment/files; the Node services read `process.env` and need variables exported by your shell/process manager when overriding defaults.

Start the complete local stack from the repository root:

```sh
npm run dev:all
```

This runs the world build/game watcher, auth watcher, and Vite client together. Press Ctrl+C once to stop all three. To run them separately instead:

```sh
npm run build:world
npm run game:dev
npm run auth:dev
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/login.html
```

Create an account, choose an unclaimed living country, and begin the operation.

Local defaults use insecure development secrets. When `NODE_ENV=production`, both services refuse to start until `TICKET_SECRET` and `INTERNAL_SERVICE_SECRET` are changed.

## Runtime data

| Path | Contents |
|---|---|
| `data/auth.sqlite*` | Accounts, password hashes, browser sessions |
| `data/game.json` | Authoritative simulation and permanent account-country seats |
| `public/world` | Generated world package used by client and server |
| `artifacts` | Road cache and QA reports/screenshots |

These paths are gitignored. Game saves use serialized atomic JSON replacement; auth uses strict SQLite tables in WAL mode. The world compiler promotes through a staging directory and restores the previous package if promotion is interrupted.

Deleting the game save resets the world and country assignments. Deleting auth SQLite resets accounts/sessions. Back up before doing either.

## Main commands

| Command | Purpose |
|---|---|
| `npm run dev:all` | Start the client, auth server, and game server together |
| `npm run dev` | Start Vite client |
| `npm run game:dev` | Watch authoritative game server |
| `npm run auth:dev` | Watch auth server |
| `npm run reset:data` | Confirm, then erase all local accounts and game runtime data |
| `npm run build:world` | Generate `public/world` |
| `npm run build` | Generate world, check workspaces/root TypeScript, build production client |
| `npm run check` | Workspace/root checks, script lint, architecture test, full Vitest suite |
| `npm test` | Generate world and run Vitest |
| `npm run visual-check` | Playwright renderer captures/report |
| `npm run performance-check` | Playwright renderer benchmark/report |

See [Development and QA](docs/development.md) for environment details, focused checks, debug mode, output paths, and the current QA authentication-harness limitation.

## Controls

| Input | Action |
|---|---|
| Left drag | Orbit and tilt |
| Middle drag | Pan |
| One-finger drag | Pan |
| Right click | Issue the selected army's order (never moves the camera) |
| Wheel / ctrl+wheel / pinch | Cursor-centered zoom |
| Two-finger trackpad swipe | Pan (auto-detected) |
| WASD or arrow keys | Pan relative to camera |
| `=` / `-` (or numpad `+` / `-`) | Zoom in / out |
| N | Arm a strategic strike (if a warhead is ready), then click an enemy province |
| Escape | Deselect / cancel the current targeting context |

Move, Attack, Retreat, Split, Stop, and Extract are issued from the army action
panel and then a map click — there are no per-command keyboard shortcuts. Map
modes, production/construction, rally points, resources, battle summaries, and
artillery state are exposed through the HUD.

On deployments with `IRONFRONTS_DEBUG_CONTROLS_ENABLED=true`, an authenticated
player can open the hidden inspector with Ctrl+D+E. `[`/`]` cycle renderer
views while it is open. URL parameters and development mode do not grant debug
access, and there is no visible debug button.

## World pipeline

`npm run build:world` compiles immutable `material/` data into a version-12 static package. The pipeline rasterizes province topology, generates terrain, preserves/drapes movement and visual waterways, compiles direct dirt roads/cities, places props, precomputes normals/navigation/albedo/AO, chunks render data, writes audit reports, and atomically promotes the result.

The game server loads a local copy for province lookup/pathfinding/resources; the browser loads the package URL announced during its handshake. They must be identical.

See [World generator](docs/world-generator/README.md) and [artifact reference](docs/world-generator/artifacts.md).

## Documentation

The full handbook is indexed at [docs/README.md](docs/README.md):

- [Auth server](docs/auth-server/README.md)
- [Game server](docs/game-server/README.md)
- [Browser client](docs/client/README.md)
- [WebGPU renderer](docs/client/rendering.md)
- [World generator](docs/world-generator/README.md)
- [Development and QA](docs/development.md)
- [Deployment](docs/deployment.md)

Third-party asset terms are recorded in [visual/UI credits](docs/ASSET_CREDITS.md) and [audio credits](AUDIO_CREDITS.md).

## Production notes

The two Node services bind loopback only and expect a reverse proxy. Production needs HTTPS/WSS, exact `CLIENT_ORIGIN`, private internal game routes, high-entropy independent shared secrets, writable auth/game persistence, and an immutable world package/CDN with appropriate CORS.

There is currently one authoritative game process, no horizontal scaling/leader election, no offline simulation catch-up, and no supplied container/proxy/service manifests. See [Deployment](docs/deployment.md) before exposing a build.

## Source-of-truth rules

- The game server is the sole gameplay writer.
- The auth server is the sole credentials/session writer.
- The client is a filtered replica and presentation layer.
- The generated world package is immutable runtime input.
- Shared wire changes start in `packages/protocol`.
- Domain rules stay browser-free under `src/game` / `packages/game-core`.

These boundaries are documented and partly enforced by architecture tests.
