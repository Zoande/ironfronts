# Configuration and Operations

## Requirements and commands

- Node.js 22 or newer
- Installed npm workspace dependencies
- A complete generated world package at `WORLD_DIRECTORY`
- Write access to the directory containing `GAME_DATA_PATH`

Development:

```sh
npm run build:world
npm run game:dev
```

Type-check the server workspace:

```sh
npm run check --workspace @ironfronts/game-server
```

The root `npm run check` covers every workspace, architecture checks, script linting, and the full automated suite.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GAME_PORT` | `3002` | Positive TCP port for internal HTTP and gameplay WebSocket traffic. |
| `CLIENT_ORIGIN` | `http://127.0.0.1:5173` | Exact allowed WebSocket `Origin`. No list or wildcard matching is performed. |
| `WORLD_PUBLIC_URL` | `${CLIENT_ORIGIN}/world` | Browser-visible base URL announced in `hello`; trailing slash is removed. The game server does not serve these assets. |
| `WORLD_DIRECTORY` | `public/world` | Local authoritative world package, resolved from the process working directory. |
| `GAME_DATA_PATH` | `${DATA_DIRECTORY}/game.json` | Save path. Overrides `DATA_DIRECTORY`. |
| `DATA_DIRECTORY` | `data` | Default state directory when `GAME_DATA_PATH` is absent. |
| `DIAGNOSTICS_PATH` | unset | Optional JSONL diagnostics path. No diagnostics file or browser telemetry upload when unset. |
| `TICKET_SECRET` | local development value | HMAC secret used to verify gameplay tickets. Required to differ from the fallback in production. Must match the issuer. |
| `INTERNAL_SERVICE_SECRET` | local development value | Bearer secret protecting `/internal/v2/*`. Required to differ from the fallback in production. Must match callers. |
| `IRONFRONTS_DEBUG_CONTROLS_ENABLED` | `false` | Explicit deployment gate for hidden debug controls and cheat commands. Authenticated clients open the inspector with Ctrl+D+E. |
| `NODE_ENV` | unset | When equal to `production`, startup rejects either fallback secret. |

Paths are resolved against `process.cwd()`. Start the process from the repository root unless explicit absolute paths are supplied.

Example production-oriented environment:

```dotenv
NODE_ENV=production
GAME_PORT=3002
CLIENT_ORIGIN=https://play.example.com
WORLD_PUBLIC_URL=https://cdn.example.com/world-at-war-2
WORLD_DIRECTORY=/srv/ironfronts/world-at-war-2
GAME_DATA_PATH=/var/lib/ironfronts/game.json
TICKET_SECRET=replace-with-a-long-random-shared-secret
INTERNAL_SERVICE_SECRET=replace-with-a-different-long-random-secret
```

## Network exposure

The process binds only to `127.0.0.1`. A same-host auth service or reverse proxy can reach it; remote clients cannot connect directly without a proxy. Route only what is needed:

- `GET /health` may be exposed to infrastructure monitoring if desired.
- `/internal/v2/*` is service-to-service and should remain private even though it has bearer authentication.
- WebSocket upgrades for `/v2/game` may be proxied to players. Preserve the browser `Origin` header and configure `CLIENT_ORIGIN` to its exact expected value.

The world asset URL in `hello` should point to the static host/CDN. Do not proxy the heavy world package through this process.

## Health and logs

`GET /health` does not require credentials and returns:

```json
{
  "ok": true,
  "service": "game-server",
  "gameId": "world-at-war-2",
  "revision": 42
}
```

This proves that the HTTP loop is responding and the runtime was constructed. It is not a deep filesystem or timer-liveness probe.

Application logs are newline-delimited JSON on standard output. Every normal log includes `timestamp`, `level`, `service`, and `event`. Current high-value events are:

- `listening`
- `client_connected`
- `country_claimed`
- `incompatible_save_archived`
- `game_save_failed`
- `shutdown`
- `final_game_save_failed`

Transport validation failures are sent to the relevant socket and are not currently logged server-side.

## Timers and capacity characteristics

| Work | Cadence |
|---|---|
| Authoritative simulation | 100 ms / 10 Hz |
| Projection diff and event publication | 250 ms / 4 Hz |
| Save snapshot | 5 seconds |
| Civil clock correction | 60 seconds |

The process is single-threaded. Simulation, projection construction, JSON serialization, HTTP, and WebSocket callbacks share the Node event loop. Projection work is deduplicated by country per publish pass, but all connected sockets and all visible state still affect cost.

There is no offline catch-up. When the process stops, simulation ticks, game-time economy, movement, and combat cooldowns stop. The persisted civil start epoch is retained, but it does not advance gameplay while offline.

## Graceful shutdown

`SIGINT` and `SIGTERM`:

1. Stop all recurring timers.
2. Close gameplay sockets with code `1001` and reason `Server shutting down`.
3. Queue and flush a final snapshot.
4. Close the HTTP server and exit `0`.

If the final save fails, the process logs `final_game_save_failed`, closes the server, and exits `1`. A five-second hard timeout also exits `1`. Because save writes are serialized, shutdown waits behind any already queued save.

## Backup and restore

The live save is a self-contained JSON snapshot. For an operator backup, copy it while the server is stopped, or copy a known-complete file while running; atomic rename means readers observe the previous or next complete snapshot, not a partial write.

To restore, stop the process, replace `GAME_DATA_PATH` with the selected compatible file, and restart. The save must match the current format, runtime version, game ID, game version, and authoritative world hash. A mismatch is automatically moved aside and a fresh game starts; see [State, world loading, and persistence](persistence.md).

## Security notes

- Use independent high-entropy values for the two secrets.
- Keep the internal API on a trusted network boundary.
- Terminate TLS at the reverse proxy and expose the gameplay endpoint as `wss://` in production.
- Keep the save directory private; snapshots contain all countries' authoritative state and permanent account-to-country assignments.
- Ticket nonces are process-local and single-use. A restart clears the replay cache, while ticket expiry still applies.
- The gameplay server enforces a 32 KiB WebSocket message limit and a 32 KiB internal HTTP request-body limit.
