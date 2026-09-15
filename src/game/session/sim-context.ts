/**
 * The slice of `GameSession` the per-tick systems and command helpers need.
 *
 * Systems (`movement`, `extraction`, `production`, `combat`, `ai`) take a
 * `SimContext`, not the `GameSession` class — that keeps the dependency graph
 * acyclic (`game-session` imports the systems, never the reverse) while still
 * giving them the authoritative state, the movement graph, and the world facts.
 * `GameSession` satisfies this structurally.
 */

import type { GameState } from '../game-state';
import type { LandGraph } from '../movement/graph';
import type { WorldData } from '../world-data';

export interface SimContext {
  readonly state: GameState;
  readonly graph: LandGraph;
  readonly world: WorldData;
}
