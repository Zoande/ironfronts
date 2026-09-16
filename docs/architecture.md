# Repository Architecture

Ironfronts is an npm-workspace monorepo containing a WebGPU client, two Node.js services, shared protocol/game packages, an offline world compiler, and browser QA tooling.

## Runtime topology

| Component | Default endpoint | Owns |
|---|---|---|
| Browser client | `http://127.0.0.1:5173` | Input, UI, WebGPU presentation, local replica, pending command feedback |
| Auth server | `http://127.0.0.1:3001` | Accounts, passwords, browser sessions, public lobby facade, short-lived game tickets |
| Game server | `http://127.0.0.1:3002` | Country seats, simulation, commands, fog projections, game persistence |
| Static world host | `/world` below the client/CDN origin | Immutable generated world manifest, fields, meshes, instances, and sidecars |

The normal connection flow is:

1. The browser registers or signs in through the auth server and receives an HttpOnly session cookie.
2. The browser asks the auth server for the lobby and permanently claims an available country.
3. The auth server calls the game server's private HTTP API using the internal service secret.
4. The browser asks the auth server for a 30-second, single-use game ticket.
5. The browser opens the game WebSocket and authenticates with that ticket.
6. The game server supplies a fog-filtered baseline and the exact world package descriptor.
7. The browser loads the static package, renders it, sends commands, and applies authoritative deltas.

The browser never receives the game server's full state. The auth service never mutates gameplay directly, and the game server never handles passwords.

## Repository map

| Path | Purpose |
|---|---|
| `apps/auth-server` | Node HTTP authentication and lobby gateway |
| `apps/game-server` | Authoritative simulation host and gameplay WebSocket |
| `apps/client` | Stable Vite browser entrypoints |
| `packages/protocol` | Shared v3 gameplay wire schemas, types, and ticket signing |
| `packages/game-core` | Browser-free exports for authoritative game rules |
| `src/game` | Plain game state and domain systems used by game-core |
| `src/client` | Browser auth API, connection, replica, clock, and remote-session adapter |
| `src/app` | Browser bootstrap, launch lifecycle, and game orchestration |
| `src/ui`, `src/menu` | In-game HUD and pre-game menu |
| `src/rendering`, `src/renderer.ts`, `src/shaders` | WebGPU implementation, stable renderer facade, and WGSL programs |
| `src/audio` | Web Audio buses, ambience/effects, and music state machine |
| `scripts/world`, `scripts/infrastructure` | Deterministic world compiler stages |
| `scripts/qa` | Shared Playwright browser/report helpers |
| `material` | Immutable source geometry, topology, movement, and metadata |
| `public` | source static assets plus ignored generated `public/world` output |
| `tests` | Domain, server, client, renderer-support, and architecture tests |

## Authority and data ownership

| Data | Authority | Persistence |
|---|---|---|
| Account/password/session | Auth server | SQLite (`data/auth.sqlite` by default) |
| Account-to-country seat | Game server | Game JSON snapshot |
| Armies, territory, economy, battles | Game server | Game JSON snapshot |
| Current browser replica | Game server projection | Memory only; replace on reconnect baseline |
| Graphics/audio preferences | Browser | Local storage |
| World geometry and authored starting data | Offline generator output | Immutable static package |
| Render/GPU caches | Browser renderer | Memory/GPU only |

`GameState` is plain serializable domain data. GPU handles, DOM objects, sockets, account password data, and world compiler structures never enter it.

## Shared boundaries

### `@ironfronts/protocol`

Defines protocol/game identifiers, client command schemas, server message shapes, lobby/session responses, projection types, and HMAC ticket helpers. Both services and the browser import it. Wire changes start here.

### `@ironfronts/game-core`

Provides the server-safe facade over `src/game`: `GameSession`, world construction, state/command types, projection helpers, unit/building catalogs, visibility, and retreat path calculation. It deliberately has no browser globals.

### Static world contract

The generator writes a versioned `world.json` plus binary artifacts. The game server loads a local authoritative copy; the browser loads the URL announced during the WebSocket handshake. Deploy both from the same immutable package.

## Dependency rules

- Domain rules may not import renderer, UI, shaders, browser globals, or service transports.
- Client presentation consumes projections and emits commands; it does not reproduce authoritative validation.
- Service entrypoints compose dependencies. HTTP/WebSocket concerns stay outside domain rules.
- Generator and QA scripts do not import browser runtime modules.
- Shader modules remain independent of renderer orchestration and domain code.
- Complex command/combat behavior belongs in focused submodules behind stable facades.
- UI and rendering modules may not depend on application orchestration under `src/app`.

These constraints are partly enforced by `tests/architecture.test.ts`.

## Version axes

Several versions intentionally move independently:

- Protocol version controls accepted wire messages.
- Game ID/version controls the hosted ruleset and save compatibility.
- Game-state/save format controls persisted JSON.
- World manifest/generation-report versions control static artifacts.
- npm package versions are currently workspace development versions and are not the gameplay compatibility contract.

See the [game-server docs](game-server/README.md), [auth-server docs](auth-server/README.md), [client docs](client/README.md), and [world-generator docs](world-generator/README.md) for each boundary.
