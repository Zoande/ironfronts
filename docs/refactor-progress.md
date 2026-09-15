# Authoritative gameplay refactor

Scope: approved audit items 1–28. This code pass is complete. It deliberately excludes visual testing and replacement-quality army model assets.

## Timeline and simulation

- `GameState.clock` owns one persisted timeline beginning at 1939-09-01 10:00 UTC. The server derives civil time from that epoch and elapsed simulation time; the client only interpolates synchronized readings.
- The simulation integrates deterministic 100 ms fixed steps. Scheduler delay and fractional step time remain as debt, so callback stalls and high debug speeds do not discard simulation work.
- Development controls can set the civil epoch, simulation multiplier, and an independent movement multiplier. Normal movement pacing remains unchanged.
- Combat applies simultaneous continuous damage each fixed step. The balance regression measures standard infantry at about two real hours for 1v1, a substantially faster 10v1 result, and a slower 10v10 result. A finer timestep produces the same outcome within tolerance.

## Movement, combat, and rules

- Movement retains physical partial-edge position, validates every road edge and transit relation, detects swept hostile contact, pursues moving targets, and revalidates orders when ownership or diplomacy changes.
- Attack confirmation declares the complete required war set atomically. Failed commands leave diplomacy and orders unchanged.
- Capture, extraction, rally movement, production stacking, splitting, stopping, and retreats use exact authoritative arrival/edge rules. Retreat protection lasts until the selected escape node is reached.
- Battles use stable monotonic front IDs, independent front baselines, simultaneous damage, sublinear frontage, role/armor profiles, reinforcement handling, deterministic cleanup, and continuous artillery with visibility/range checks.
- Visibility uses the strongest applicable unit ranges and server-side capabilities expose extraction, production, construction, rally, and legal retreat actions.

## Client and transport truthfulness

- Per-country projections are detached snapshots with fog redaction, explicit capabilities, timestamps, movement routes, and bounded trajectory data.
- The interpolation buffer follows every verified road corner between samples, bounds extrapolation to 500 ms, freezes stale state, and snaps unverified corrections. Rendering and CPU picking use the same presented trajectory.
- Commands create pending intent and disable conflicting controls without mutating factual replica data. Pending state clears only when the acknowledged revision is installed; acknowledgement/delta ordering is race-safe.
- Nested protocol v3 messages use concrete runtime schemas. Revisions advance only after accepted delivery; gaps trigger one bounded resync. Reconnect obtains a fresh ticket and installs a replacement baseline.
- Event-only deltas are published, events have monotonic IDs and kind-specific ownership/identity/location fields, and bounded per-country backlogs survive disconnected recipients and socket backpressure within the running process. Clients deduplicate retried IDs.

## Persistence, world identity, and performance

- State-v2 timing data migrates exactly once to state v3. Restore validates owners, graph positions/edges/orders, queues, rallies, battles/fronts, extraction links, relations, resource nodes, and monotonic counters after rebuilding immutable world caches.
- World identity covers SHA-256 hashes of the manifest, province details, owners, province IDs, surface, height, and movement connections. The server restricts manifest gameplay paths to those canonical files; the browser verifies the aggregate identity and every gameplay artifact it downloads.
- Dijkstra routing uses a binary heap. Visibility, contact, and front detection use wrapped spatial indexes; movement updates its phase index as armies move. Pursuit visibility and retreat province-node searches are cached for the phase/world.
- A code benchmark exercises a 10,000-node route graph and 10,000 spatial entries with a two-second guard.

## Source organization

- Browser orchestration now lives under `src/app`, rendering implementation under `src/rendering`, HUD implementation/state under dedicated `src/ui` subfolders, and authoritative state/session code under `src/game/state` and `src/game/session`. Thin compatibility facades preserve supported imports.
- A runtime reachability check rejects TypeScript modules that are no longer reachable from an application or package entrypoint.
- Campaign victory/outcome evaluation and its protocol, persistence, UI, and audio surfaces were removed; campaigns continue simulating after capitals or territory are lost.
- Server scheduling and projection publication are separate from process composition.
- Combat is divided into damage, fronts, retreat, artillery, capture, constants, and event types.
- Movement is divided into orders, policy, position, speed, contact, pursuit, naval transit, retreat, heap routing, and spatial indexing.
- CPU picking, queue grouping, and renderer road-junction generation are separate modules. Architecture tests reject cycles and presentation dependencies in the authoritative game layer.
- Superseded overloads, local rule duplication, obsolete audit artifacts, and the protocol-v2 document were removed. Current protocol, simulation, persistence, architecture, deployment, and validation docs describe the resulting behavior.

## Compatibility and validation

Protocol and game-state versions are 3; the game ruleset is `world-at-war@3`. Save envelope/runtime versions remain 2. Process downtime is not simulated; only in-process scheduler delay is retained.

Refactor validation:

- Workspace/root TypeScript, script lint, architecture checks, the dead-code reachability audit, and the focused refactor regression suites passed.
- Generated-world, workspace TypeScript, and the production client build passed.
- The full suite still contains unrelated pre-existing gameplay/balance expectation failures; this organizational refactor does not alter those systems to make stale assertions pass.
- `git diff --check` passed; only configured LF-to-CRLF working-tree notices were emitted.

Per the requested scope, no visual/performance tests, deployment, manual live-save edits, or army model asset changes were performed.
