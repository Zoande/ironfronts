# Development and QA

## Prerequisites

- Node.js 22 or newer (the auth store uses the built-in `node:sqlite` API)
- npm
- Current desktop Chrome or Edge with WebGPU for interactive/visual work
- Sufficient disk/time to generate the world package

Install once:

```sh
npm install
```

## Environment setup

`.env.example` lists the combined client/service variables. Vite automatically reads supported `.env` files for `VITE_*` values. The Node service entrypoints read `process.env` directly and do not import a dotenv loader, so export their variables through the shell, Node/process-manager environment support, or another explicit loader.

For local defaults, only the generated world and matching service secrets are required. Production mode rejects the built-in secret fallbacks.

## Local process order

Start the full stack from the repository root:

```sh
npm run dev:all
```

The launcher stops every service when Ctrl+C is pressed or when one service exits. To manage each process separately:

```sh
npm run build:world
npm run game:dev
npm run auth:dev
npm run dev
```

Recommended order is world → game → auth → client. The auth service can listen while the game is down, but assignment-dependent session/lobby operations will fail.

Open `http://127.0.0.1:5173/login.html`, create an account, select a country, and launch.

Generated runtime data:

- `public/world/`: compiled static world
- `data/auth.sqlite*`: accounts and browser sessions
- `data/game.json*`: simulation and country seats
- `artifacts/`: QA reports/screenshots and road cache

All are ignored by git. Removing `data/game.json` resets the world/seats; removing the auth database resets accounts/sessions. Preserve backups before resetting either.

## npm scripts

| Script | Behavior |
|---|---|
| `npm run dev:all` | Run the Vite client, auth watcher, and world-build/game watcher as one stack |
| `npm run dev` | Vite client at `127.0.0.1:5173` |
| `npm run dev:fast` | Same current Vite invocation as `dev` |
| `npm run auth:dev` | Watch/restart auth server through `tsx` |
| `npm run game:dev` | Watch/restart game server through `tsx` |
| `npm run reset:data` | Ask for confirmation, then reset the repository's local `data/` directory |
| `npm run build:world` | Compile and atomically promote `public/world` |
| `npm run pregame:dev` | Alias for world build |
| `npm run build` | Build world, check workspace builds, root TypeScript, then Vite production assets |
| `npm run preview` | Preview Vite production output |
| `npm run check` | Workspace checks, root TypeScript, script lint, architecture test, and full Vitest run |
| `npm test` | Runs `pretest` (world generation), then Vitest |
| `npm run test:architecture` | Architecture dependency tests only |
| `npm run lint:scripts` | ESLint over generator/QA `.mjs` scripts |
| `npm run visual-check` | Playwright visual/diagnostic capture |
| `npm run performance-check` | Playwright renderer scenario benchmark |
| `npm run import:music -- <archive>` | Import/verify the soundtrack archive into public audio |

Workspace-only type checks avoid world generation and the full suite:

```sh
npm run check --workspace @ironfronts/auth-server
npm run check --workspace @ironfronts/game-server
npm run check --workspace @ironfronts/protocol
npm run check --workspace @ironfronts/game-core
```

The client currently relies on the root TypeScript configuration rather than its own workspace check script.

## Test layout

| Area | Coverage |
|---|---|
| `tests/server` | Auth store, game runtime/persistence/projection, tickets/protocol |
| `tests/client` | Replica deltas, pending command behavior, interpolated clock, world integrity |
| `tests/game` | State/scenario/world graph, commands, movement, visibility, combat/retreat, economy/construction/resources |
| Root renderer-support tests | Camera, picking, quality, labels, environment, performance accounting, shaders, audio, UI presentation |
| `tests/architecture.test.ts` | Cycles and layer/dependency/browser-global rules |

Tests run in Vitest. World-dependent tests use the generated package, which is why the root test lifecycle invokes generation first.

## Visual check

`scripts/visual-check.mjs` launches Chromium, collects console/page errors, captures world/showcase/debug views, validates label/weather/time behavior, and writes screenshots plus `artifacts/visual-report.json`.

Browser variables:

| Variable | Default | Meaning |
|---|---|---|
| `IRONFRONTS_BROWSER` | Windows Chrome path | Chromium-family executable |
| `IRONFRONTS_HEADLESS` | Headed on Windows, headless elsewhere | Explicit `true`/`false` override |

On headless runs it enables unsafe WebGPU/SwiftShader/Vulkan flags. Hardware results from headed desktop Chrome are more representative.

Current limitation: the application requires an authenticated seat, while the QA launcher creates a fresh browser context and does not yet provision credentials/cookies. Until an automation login/fixture is added, these scripts require a harness modification or prepared authentication flow before they can reach `window.__ironfrontsRenderer`. Treat a redirect/time-out at the login page as harness setup failure, not a renderer result.

## Performance check

`scripts/performance-check.mjs` uses authenticated debug handles to measure
overview, dense urban, rain, regional, pan, orbit, zoom, and layer ablations.
Outputs:

- `artifacts/performance-report.json`
- `artifacts/performance-report.md`

Configuration:

| Variable | Default | Meaning |
|---|---:|---|
| `IRONFRONTS_BENCHMARK_MS` | 2200 | Per-scenario measurement duration |
| `IRONFRONTS_BENCHMARK_WARMUP_MS` | 600 | Warmup before sample reset |

Reports include frame percentiles, main-thread phase timing, GPU timestamps when supported, workload counts, long tasks, optional heap change, hotspot summaries, and layer cost estimates. Small negative ablation costs are expected measurement noise.

The same authentication harness limitation as visual-check currently applies.

## Debug mode

Set `IRONFRONTS_DEBUG_CONTROLS_ENABLED=true` on an approved QA deployment and
authenticate normally to expose:

- the hidden Ctrl+D+E world/server/cheat/renderer inspector;
- debug rendering views and layer toggles;
- the unified IANA-aware civil clock and persistent weather controls;
- lazy movement/waterway graph overlays;
- scheduler health, performance snapshots, and explicit cheat commands;
- `window.__ironfrontsRenderer` and `window.__ironfrontsSession` automation handles.

The game server applies the deployment gate independently to every
authenticated WebSocket connection. URL parameters, forged client messages,
and development mode do not grant access. Full projected session state is not
exposed on ordinary player pages.

## Change workflow

When changing protocol/state:

1. Update shared types/schemas.
2. Update server validation/mutation and projection.
3. Update client replica/adapter/UI.
4. Decide save/world compatibility implications.
5. Update relevant docs and focused coverage.

When changing generated artifacts:

1. Update writer and manifest types/consumers together.
2. Bump world/report versions where compatibility changes.
3. Rebuild from clean source inputs.
4. Inspect the generation report and debug views.
5. Deploy server/client copies atomically as one package.

Avoid committing generated `public/world`, runtime `data`, or QA `artifacts`.
