# Architecture

## Responsibility boundary

The game server is the sole writer of authoritative game state. Its major boundaries are:

| Layer | Responsibility | Primary source |
|---|---|---|
| Process composition | Startup, timers, persistence scheduling, publication, shutdown | `apps/game-server/src/main.ts` |
| Internal HTTP | Health, lobby reads, permanent country claims | `apps/game-server/src/internal-api.ts` |
| Gameplay transport | Upgrades, ticket authentication, command acknowledgement, connection state | `apps/game-server/src/gameplay-gateway.ts` |
| Runtime facade | Seat maps, lobby model, state projection, command adaptation | `apps/game-server/src/runtime.ts` |
| Projection | Per-country fog filtering and change-only deltas | `apps/game-server/src/projection.ts` |
| Event delivery | Drain domain event queues and filter them by country | `apps/game-server/src/event-feed.ts` |
| Persistence | Serialized atomic JSON snapshots and incompatible-save archive | `apps/game-server/src/persistence.ts` |
| World input | Load authoritative generated artifacts and calculate their aggregate identity | `apps/game-server/src/world-loader.ts` |
| Shared protocol | Runtime-validated client input and TypeScript wire contracts | `packages/protocol/src` |
| Game rules | Plain state, commands, movement, combat, economy and AI | `packages/game-core` and `src/game` |

Account credentials, login sessions, ticket issuance, and public lobby endpoints belong to the auth service. Rendering, client prediction, input modes, and replica application belong to the client. World artifact generation belongs to `scripts/`.

## Startup flow

1. Resolve configuration from environment variables.
2. Load the world manifest, sidecar metadata, and required binary fields.
3. Build the authoritative `WorldData`, movement graph inputs, and generated resource-node inputs; hash every gameplay artifact and their sorted aggregate.
4. Read `GAME_DATA_PATH` if it exists.
5. Reject and archive the save when its format, runtime version, game ID, game version, or aggregate world identity differs.
6. Restore `GameRuntime`, or initialize scenario `OP-1939-01` in campaign mode.
7. Restore the civil clock's original start epoch when a compatible save exists.
8. Write an initial snapshot for a fresh game.
9. Attach internal HTTP and gameplay WebSocket handling to one Node HTTP server.
10. Start simulation, projection publication, persistence, and clock-sync timers.
11. Bind to `127.0.0.1` on `GAME_PORT`.

Startup is intentionally fail-fast. Malformed world files, unreadable JSON, invalid persisted seats, and filesystem errors prevent the process from accepting players.

## State ownership

`GameRuntime` owns one `GameSession`. `GameSession` owns one JSON-serializable `GameState`; its systems are the only gameplay writers. World data and its graph-derived caches are immutable after load.

Commands cross the boundary in this order:

1. `clientMessageSchema` validates the wire envelope and command payload.
2. The authenticated connection supplies `countryId`; clients cannot choose it in a command.
3. `GameRuntime.command` performs world-bounds validation for coordinate commands and adapts the payload to a domain command.
4. `GameSession.applyCommand` dispatches through the authoritative ownership gate.
5. The relevant domain service validates current state and either commits all mutations or returns a failure.
6. The transport caches and returns a `commandAck` for that `commandId`.
7. Successful commands request a background save; regular snapshots provide an additional durability bound.

No client-supplied composition, position, damage, resource total, relation, cooldown, or country identity is trusted.

## Projection and publication

Every connected country receives its own projection. A projection contains public country/territory data, that country's private economy and queues, and only armies/resource nodes allowed by fog of war.

At 250 ms intervals, the process:

1. Drains queued domain events once into bounded per-country backlogs.
2. Builds at most one current projection per connected country.
3. Diffs it against each connection's last successfully delivered projection.
4. Sends state changes and event-only deltas with events filtered for that country.
5. Advances connection and process revisions only after socket delivery accepts the message.

The revision is a transport sequence, not a simulation tick and not persisted. A reconnect always establishes a new baseline at the current process revision.

## Source organization and refactoring policy

Public facades remain deliberately small:

- `src/game/commands.ts` is the command ownership gate and dispatcher. Complex command workflows live under `src/game/commands/`.
- `src/game/combat.ts` coordinates battles, retreat, and artillery. Pure damage/frontage math and province capture live under `src/game/combat/`.
- `src/game/units/movement.ts` coordinates fixed-step movement. Orders, position, contact, pursuit, policy, retreat, speed, heap routing, and spatial indexing have focused modules.
- `src/app/bootstrap.ts` composes browser state; army interpolation/upload and rendering support live under `src/rendering/`, client transport under `src/client/`, queue rendering under `src/ui/`, and road-junction generation under `src/graphics/`.
- `apps/game-server/src/main.ts` composes the process. Scheduling, publication, HTTP, gameplay sockets, event filtering, persistence, and world loading are separate modules.

When adding behavior, put validation and mutation with the owning domain. Avoid adding game rules to the WebSocket handler, transport concepts to `GameState`, or fog decisions to client code. A useful rule is: the entrypoint schedules, the runtime adapts, the domain decides, and projection redacts.

## Event model

`GameSession` accumulates unit completion, building completion, combat, and capture events in in-memory queues. `event-feed.ts` drains them for publication:

- Unit and building completion events go only to the owning country.
- Combat events go only to the attacker and defender countries named by the event.
- Capture events are public.

These event notifications are transient presentation aids. They are not persisted across process restart. The publisher holds up to 512 filtered events per country while no recipient is connected or a socket is under backpressure, and removes a batch only after every current recipient accepts it. Reconnect baselines remain the durable reconciliation source, and clients deduplicate event IDs.
