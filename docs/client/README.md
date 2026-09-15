# Browser Client

The client is a Vite application with two HTML entries: `login.html` and the main dossier/game page in `index.html`. It authenticates through the auth server, maintains a filtered replica of the game server, and renders the generated world through WebGPU.

## Requirements and development

- Current desktop Chrome or Edge with WebGPU and hardware acceleration
- Client, auth server, and game server configured with matching origins/endpoints
- A built `public/world` package

```sh
npm run build:world
npm run game:dev
npm run auth:dev
npm run dev
```

The only client environment variable is:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_AUTH_URL` | `http://127.0.0.1:3001` | Auth API base URL compiled into the browser bundle. Trailing slash is removed. |

Vite runs on `127.0.0.1:5173` in the supplied script. `vite.config.ts` builds both HTML entries and copies audio, menu, texture, and generated world directories into the production output.

## Entrypoints

`apps/client/src/main.ts` imports the stable `src/main.ts` facade; application orchestration lives in `src/app/bootstrap.ts`. `apps/client/src/login.ts` owns the login/register page.

### Login page

On load, the page calls `GET /v1/auth/session`. An already authenticated browser is redirected to `/`. The form switches between login and registration, submits credentials, displays the server's error, and redirects to `/` on success.

### Main page

The main entry checks the session before mounting the menu. An unauthenticated browser is redirected to `/login.html` and bootstrap is halted. It then fetches the v2 lobby and mounts the country-selection menu.

The expensive renderer module graph, WebGPU device, and world assets are deliberately deferred until the player begins/continues an operation. Launch performs:

1. Claim the selected country if the account has no assignment.
2. Switch music to the opening state.
3. Verify `navigator.gpu`.
4. Request a game ticket and open/authenticate the gameplay WebSocket.
5. Receive the world descriptor and authoritative baseline.
6. Set the world asset base URL announced by the server.
7. Dynamically import and initialize `WorldRenderer`.
8. Adapt the connection to `RemoteGameSession` and mount the HUD.
9. Focus the authoritative start camera and upload visible armies/resources.

If WebGPU or renderer initialization fails, the unsupported/error panel replaces the canvas.

## HTTP client

`src/client/auth-api.ts` is the browser's auth/lobby facade. Every request:

- targets `VITE_AUTH_URL`;
- sends cookies with `credentials: include`;
- uses JSON content type;
- parses JSON and throws the response's `error` field for non-2xx status.

It exposes session, login, register, logout, lobby, join, and game-connect operations. See [Auth Server](../auth-server/README.md) for endpoint details.

## Gameplay connection

`GameConnection` owns the WebSocket and exact authoritative replica.

- Obtains a fresh connection descriptor/ticket from the auth server.
- Requires protocol version 3.
- Opens the socket and authenticates immediately.
- Times initial connection out after 10 seconds.
- Runtime-validates every server message.
- Stores world descriptor, presentation catalogs, projection, and revision.
- Applies a delta only when `fromRevision` matches the current revision.
- Requests a full resync on a revision gap.
- Resolves command callbacks from `commandAck`.
- Times commands out locally after five seconds.
- On an established connection loss, retries after one second; failed reconnect attempts retry every 2.5 seconds.
- Settles every pending command as failed when a socket closes.

Reconnection obtains a new single-use ticket and receives a current baseline. Client command IDs combine current time and a per-instance sequence; the server provides process-local deduplication.

## Replica and pending commands

`replica-store.ts` applies projection deltas by cloning the previous projection, replacing top-level changed fields, upserting collection records, and deleting removals.

`RemoteGameSession` gives the UI a session-shaped adapter over that replica. It provides ownership/province helpers, authoritative capabilities, catalogs, command methods, current clock, selection summaries, and event queues.

Commands create pending intent without changing authoritative orders, queues, status or resources. Acknowledgements identify the applied revision; pending intent clears when that revision is installed. Rejections remove intent and show the server reason. Timeouts trigger resynchronization because the outcome may be unknown.

War confirmation preserves the union of previously approved countries when another transit country requires consent.

## UI architecture

The UI has three layers:

- `src/menu`: pre-game dossier, country selection, settings, and audio interaction.
- `src/ui/ui-state.ts`: small typed observable store shared by game UI components.
- `src/ui/game-ui.ts`: stable HUD facade; shell composition lives under `src/ui/shell` and styling under `src/ui/styles`.

`src/app/bootstrap.ts` connects renderer callbacks, remote-session updates, UI state/actions, audio state, selection/targeting workflows, and teardown. The renderer is a presentation/cache layer; the UI reads projected state and sends commands through `RemoteGameSession`.

The client refreshes civil clock display every 250 ms and HUD/marker projections every 400 ms. These are presentation cadences and do not advance gameplay.

### Army actions

The army panel supports Move, Attack, Retreat, Split, Stop, and Extract with contextual enablement. Targeting workflows consume map clicks:

- Move chooses a graph/land position.
- Attack chooses a province or detected army; artillery-only forces select an in-range army.
- Retreat chooses a projected legal exit.
- Split first gathers per-type counts, then chooses a detachment destination.

The client may reject obvious non-owned selections for feedback, but the game server always revalidates ownership and rules.

### Map and selection synchronization

Authoritative province owners update renderer political textures incrementally. The client uploads fog-filtered resource nodes and army formations to GPU instance buffers. Province and army selection are mutually coordinated so the HUD does not show two active contexts.

An army formation uses at most four 3D model slots. Visual categories are infantry, light armor, heavy armor, and artillery; each present category receives a slot before deterministic proportional allocation. One shared marker/health/selection treatment represents the army.

## Clock and environment

The civil clock derives from the persisted simulation timeline. `InterpolatedGameClock` interpolates server samples at the announced simulation speed and freezes stale prediction. Debug epoch changes snap by generation. New samples correct drift gradually at at most 10% faster/slower display speed, avoiding hand jumps. The fixed server UTC offset is used for day/hour/minute display.

The client freezes the renderer's independent demo time cycle and drives lighting from the interpolated server clock. Rain is currently a presentation/debug control rather than an authoritative gameplay system.

## Audio

`AudioManager` owns Web Audio buses for master, music, UI, ambience, and effects. Preferences are normalized to `0..1` and stored under `ironfronts.audio.v1`; unavailable storage degrades to in-memory defaults.

Browser autoplay restrictions are handled by priming menu music/assets and retrying unlock on the first real pointer/keyboard interaction. UI sample failures fall back to generated oscillator/noise cues. Ambience includes wind, rain, and proximity-driven ocean. Thunder is a spatial HRTF proof of concept.

`MusicDirector` is a state machine for menu, opening, peace, and war. It avoids a recent-history window of four tracks, waits a state-specific randomized gap between tracks, and tries remote official sources before local archive fallbacks. Credits and redistribution terms are in `AUDIO_CREDITS.md`.

## Preferences

| Preference | Storage key | Notes |
|---|---|---|
| Graphics quality | `ironfronts:graphics-quality` | `low`, `medium`, `high` (default), or `ultra` |
| Audio buses | `ironfronts.audio.v1` | JSON master/music/UI/ambience/effects levels |

Storage reads/writes are guarded so privacy modes or unavailable local storage do not break startup.

## Controls

| Input | Action |
|---|---|
| Left drag / one-finger drag | Pan map |
| Right drag | Orbit and tilt |
| Mouse wheel | Cursor-anchored zoom |
| Two-finger drag/pinch | Pan and zoom |
| WASD / arrow keys | Pan relative to camera |
| M with an army selected | Enter move targeting |
| S with an army selected | Stop order |
| E with an army selected | Extract |
| Escape | Deselect army/cancel selection context |

Debug controls are available to authenticated players only on a deployment
with `IRONFRONTS_DEBUG_CONTROLS_ENABLED=true`:

- Ctrl+D+E opens/closes the inspector; there is no visible debug button.
- `[` and `]` cycle renderer debug views while it is open.
- Inspector tabs cover world layers and graphs, the unified world clock and
  persistent weather, server health, explicit cheats, and renderer/audio diagnostics.

URL parameters and development mode do not grant debug access.

## Teardown and failure behavior

On non-bfcache `pagehide`, the client stops music/audio, destroys UI, clears presentation timers/listeners, closes the game connection, and disposes renderer resources. A lost WebGPU device logs the reason and reloads when the renderer was running. Uncaptured GPU validation errors are reported to the console.

## Current limitations

- Desktop WebGPU is required; there is no WebGL renderer.
- The main orchestration file remains large and is a future refactor target.
- Some debug controls represent renderer-local experimentation rather than server rules.
- Optimistic queue entries use client timestamps only as temporary display IDs.
- There is no offline mode; authentication, lobby, and game connection are required.

See [Rendering](rendering.md) for GPU/world details and [Game-server protocol](../game-server/protocol.md) for the authoritative wire contract.
