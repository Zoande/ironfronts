# Game Server

This directory documents the authoritative Ironfronts game server as implemented by `apps/game-server`, `packages/game-core`, and the game-facing part of `packages/protocol`.

The server owns one continuously running **World at War** game. It owns the simulation, country seats, command validation, fog-of-war projections, game state persistence, and the HTTP/WebSocket interfaces used to enter and play that game. The browser is a replica and presentation layer; it is never authoritative.

This documentation intentionally does not cover account/session management, browser implementation, or how the world package is generated. It does cover the server's use and validation of the generated world package because that is part of starting and preserving a game.

## Documentation map

- [Architecture](architecture.md): process boundaries, source layout, ownership, data flow, and extension points.
- [Configuration and operations](operations.md): environment, startup, health, logs, deployment, shutdown, and recovery.
- [Protocol v3](protocol.md): gameplay WebSocket, commands, messages, revisions, delivery, and errors.
- [Authoritative simulation](simulation.md): tick order, movement, combat, retreat, artillery, economy, production, construction, extraction, capture, AI, and fog of war.
- [State, world loading, and persistence](persistence.md): save format, atomic writes, compatibility checks, backups, seats, and restart behavior.
- [Validation and troubleshooting](validation.md): checks, useful diagnostics, failure modes, and invariants.

## Quick start

From the repository root:

```sh
npm install
npm run build:world
npm run game:dev
```

The default process listens on `127.0.0.1:3002`, loads authoritative world data from `public/world`, and stores the game at `data/game.json`. In production, set both secrets and place a reverse proxy or trusted service in front of the loopback-only listener. See [Configuration and operations](operations.md).

## Stable contracts

- Protocol version: `3`
- Game ID: `world-at-war-2`
- Game version: `world-at-war@3`
- Save format and runtime snapshot version: `2`
- Authoritative simulation cadence: 10 ticks per real second while the process is running
- Projection publish cadence: up to 4 updates per real second
- Combat: continuous damage integrated in fixed 100 ms simulation steps

Changing a wire shape belongs in `packages/protocol`. Changing authoritative rules belongs in `packages/game-core` / `src/game`. The server process should coordinate those modules rather than duplicate their rules.

## Persistent army order queues

Shift-click move and attack orders are stored on the authoritative army, up to 32
pending orders. They survive browser reloads, disconnects and server save/restore.
The simulation starts the next order when the army becomes idle. Intermediate
waypoints do not merge the ordered stack into friendly troops and discard its queue.
A successful direct move, attack, stop, retreat, split or extraction replaces the queue;
a rejected command leaves it intact.

The server revalidates each leg when it starts. A lost target, blocked route or
required new war stops the queue and exposes the reason in the army activity line.
Queued orders never silently declare a new war. Starting a move while extracting
interrupts renewable extraction rather than waiting forever for it to finish.

The selected army shows its pending count and dashed arrows to queued destinations.
These indicate intent; the solid active route is the authoritative legal road path.
Hidden enemy positions are never used to draw queued target arrows. Queue support
is negotiated in the handshake so a new client cannot turn an enqueued command
into an immediate replacement on an older server.
