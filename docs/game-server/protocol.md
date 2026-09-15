# Gameplay protocol v3

The game server accepts WebSocket upgrades at `/v2/game`; the route name is retained for deployment compatibility, while every ticket and message uses protocol version 3. The server sends `hello`, a filtered `baseline`, and debug-capability state after authentication.

Clients send authenticated command envelopes with a unique command ID. Commands cover move, attack, retreat, split, stop, extract, produce, build, rally, diplomacy, and strategic strikes. The server validates ownership and all game rules. A successful command is published before its acknowledgement; the acknowledgement carries the applied projection revision. Duplicate command IDs return the cached acknowledgement.

The client treats commands as pending intent. It does not change factual projection fields. Pending intent clears once the acknowledged revision is installed. If the acknowledgement is lost or late, the client requests a baseline because the outcome is unknown.

Each delta names `fromRevision` and `revision`. A gap, duplicate, or reversal triggers one resync request and a five-second resync deadline. Baselines replace the replica and increment a presentation generation. Heartbeats detect stale sockets; reconnect performs a new ticket exchange and baseline. A different world identity makes the session incompatible and requires returning to command.

Nested server messages are validated with concrete schemas, including projected armies, naval states, queues, diplomacy, capabilities, timeline data, catalogs, world hashes, deltas, and kind-specific events. Events have monotonic IDs and required ownership/location fields where applicable. The publisher keeps a bounded per-country backlog until every current recipient accepts delivery. Clients deduplicate IDs.

The gateway rejects payloads above 32 KiB and closes a connection with code 1013 once queued socket data exceeds 2 MB. Debug clock, simulation speed, movement speed, time-of-day, and weather messages are ignored unless the server explicitly enables development controls.
