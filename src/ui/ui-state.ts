/**
 * Strategic in-game UI state.
 *
 * This is the ONLY contract between the renderer/game systems and the player
 * HUD. Game systems publish typed state through `UiStore.patch(...)`; the HUD
 * subscribes and renders. The HUD never reads renderer internals and never
 * scrapes the debug DOM (no MutationObserver on `#debug-*`). The debug
 * inspector and the player HUD are independent consumers of the same
 * underlying game state.
 */

import type { FrameRateCap, QualityLevel } from '../graphics/quality';

export type MapMode = 'balanced' | 'political' | 'diplomacy' | 'clear';

export type UiPhase = 'lobby' | 'loading' | 'in-game';

export interface PlayerCountry {
  readonly name: string;
  /** CSS colour string for the flag swatch. */
  readonly color: string;
}

export type ResourceId = 'money' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil' | 'warheads';

export interface ResourceLine {
  readonly id: ResourceId;
  readonly label: string;
  /**
   * `null` means the underlying economy system does not exist yet: the HUD
   * renders a disabled "--". A number is a real, authoritative value.
   */
  readonly value: number | null;
  /** Per-tick change, when known. */
  readonly delta?: number | null;
  readonly production?: number;
  readonly upkeep?: number;
  readonly coverage?: number;
  readonly reserveHours?: number | null;
  readonly shortageSeverity?: number;
  /** Clearly-labelled demo value (dev/preview only), never a real save. */
  readonly demo?: boolean;
}

export interface StrategicClock {
  /** Campaign day in the fixed GMT+2 civil calendar; the starting day is 1. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Fractional so an analogue second hand need not jump once per second. */
  readonly second: number;
  readonly utcOffsetMinutes: number;
}

export interface WeatherState {
  readonly raining: boolean;
  readonly label: string;
}

/**
 * Deposit quantities held in a province's ground — abstract strategic
 * abundance, NOT production/day. Precomputed by the renderer; `null` when the
 * province has no known deposits.
 */
export interface ProvinceResourceTotals {
  readonly stone: number;
  readonly metal: number;
  readonly oil: number;
}

/** One entry in a production or construction queue, 0 A.D.-style. */
export interface QueueItem {
  readonly id: string;
  readonly label: string;
  /** True only for the head order — the one actually advancing. */
  readonly active: boolean;
  /** 0..1, only meaningful when `active`. */
  readonly progress: number;
  /** Estimated seconds of real time left at normal (1x) simulation speed,
   *  only meaningful when `active`. A dev speed-up will finish sooner than
   *  this reads — it is a normal-play estimate, not a live server countdown. */
  readonly etaSeconds: number;
}

export interface SelectedProvince {
  /** 0-based province id (matches FrameStats.hoveredProvince / renderer ids). */
  readonly id: number;
  readonly name: string;
  readonly owner: string;
  readonly ownerColor: string;
  readonly terrain: string;
  /**
   * Aggregated deposit quantities, or `null` when none are known. Under fog of
   * war this is `null` for provinces the player does not own — foreign deposit
   * detail must not leak.
   */
  readonly resources: ProvinceResourceTotals | null;
  readonly resourceEconomy?: {
    readonly potential: Record<'food' | 'stone' | 'metal' | 'oil', number>;
    readonly baseProduction: Record<'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil', number>;
    readonly buildings: Record<'fields' | 'quarry' | 'mine' | 'oilPump', number>;
    readonly productionBreakdown?: Record<'food' | 'stone' | 'metal' | 'oil', {
      readonly base: number; readonly passive: number; readonly engineer: number; readonly total: number;
      readonly assignedEngineers: number; readonly effectiveEngineers: number; readonly currentTier: number; readonly maximumTier: number;
    }>;
  } | null;
  /** True when the player commands this province — unlocks full detail. */
  readonly isOwn?: boolean;
  /** Held by this player but not its original owner — produces less. */
  readonly occupied?: boolean;
  /** Province has sea access (drives the water / naval marker). */
  readonly coastal?: boolean;
  /** Production facilities standing in this province (own provinces only). */
  readonly buildings?: {
    readonly barracks: number;
    readonly tankPlant: number;
    readonly ordnance: number;
    readonly missileSite: number;
  } | null;
  /** Deposit control/extraction state, own provinces only. */
  readonly deposits?: {
    readonly controlled: boolean;
    readonly extracting: boolean;
  } | null;
  /** Units this province could ever build here. Locked ones (missing building)
   *  and unaffordable ones are both included (rendered disabled) so the
   *  player can see what exists and why it's out of reach right now. */
  readonly producible?: readonly {
    readonly id: string;
    readonly name: string;
    /** Accessible/tooltip-fallback text only — render `costItems` (icon + number) to sighted users. */
    readonly costLabel: string;
    readonly costItems: readonly { readonly resource: TradeResourceKey; readonly amount: number }[];
    readonly affordable: boolean;
    readonly available: boolean;
    readonly reason?: string;
  }[];
  /** Current production queue, own provinces only. Only the head order (index
   *  0) is actively being worked and carries live progress/eta. */
  readonly queue?: readonly QueueItem[];
  /** Buildings this own urban province could ever take. Locked ones (already
   *  built/queued/unavailable here) and unaffordable ones are both included
   *  (rendered disabled) so the cost/reason is visible before it can be met. */
  readonly buildable?: readonly {
    readonly id: string;
    readonly name: string;
    /** Accessible/tooltip-fallback text only — render `costItems` (icon + number) to sighted users. */
    readonly costLabel: string;
    readonly costItems: readonly { readonly resource: TradeResourceKey; readonly amount: number }[];
    readonly affordable: boolean;
    readonly available: boolean;
    readonly reason?: string;
  }[];
  /** Buildings currently under construction here, own provinces only. Only the
   *  head order (index 0) is actively being worked. */
  readonly construction?: readonly QueueItem[];
  /** World-space rally point newly produced units march to, or null. */
  readonly rally?: { readonly x: number; readonly z: number } | null;
  readonly commandPending?: boolean;
  readonly canSetRally?: boolean;
}

export type NavId =
  | 'armies' | 'provinces' | 'production' | 'research'
  | 'diplomacy' | 'economy' | 'intelligence' | 'events' | 'trade';

export type SidePanelId = 'diplomacy' | 'research' | 'trade';
export type TechnologyBranch = 'infantry' | 'resources' | 'resourceBuildings' | 'training' | 'hybrid' | 'armored';
export type TechnologyCategory = Exclude<TechnologyBranch, 'resourceBuildings'>;

export interface TechnologyView {
  readonly levels: Record<TechnologyBranch, number>;
  readonly slots: ReadonlyArray<{ readonly branch: TechnologyBranch; readonly targetLevel: number; readonly progress: number; readonly etaSeconds: number } | null>;
  readonly quotes: Record<TechnologyBranch, { readonly hours: number; readonly cost: Partial<Record<'funds' | 'food' | 'metal' | 'oil', number>>; readonly affordable: boolean; readonly lockedReason?: string }>;
  readonly pending?: boolean;
}

export type DiplomacyRelation = 'neutral' | 'allied' | 'war';

export interface DiplomacyCountryView {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly controller: 'player' | 'ai' | 'neutral';
  readonly alive: boolean;
  readonly relation: DiplomacyRelation;
  /** Messages received since this cable was last opened. */
  readonly unreadCount?: number;
  /** Pending proposals from this country that require the player's answer. */
  readonly incomingProposalCount?: number;
}

export interface DiplomacyMessageView {
  readonly id: string;
  readonly fromCountryId: number;
  readonly toCountryId: number;
  readonly body: string;
  readonly sentAtTick: number;
}

export interface DiplomacyProposalView {
  readonly id: string;
  readonly fromCountryId: number;
  readonly toCountryId: number;
  readonly kind: 'alliance' | 'peace';
  readonly status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  readonly createdAtTick: number;
  readonly resolvedAtTick?: number;
}

export type DiplomacyBusyAction =
  | 'message' | 'alliance' | 'peace' | 'declare-war' | 'end-alliance' | 'proposal-response'
  | 'trade-offer' | 'trade-response';

export type TradeResourceKey = 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil';

export interface TradeLegView {
  readonly resource: TradeResourceKey;
  readonly amount: number;
}

export interface TradeProposalView {
  readonly id: string;
  readonly fromCountryId: number;
  readonly toCountryId: number;
  readonly offer: TradeLegView;
  readonly request: TradeLegView;
  readonly status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  readonly createdAtTick: number;
  readonly resolvedAtTick?: number;
}

export interface DiplomacyView {
  readonly viewerCountryId: number | null;
  readonly countries: readonly DiplomacyCountryView[];
  readonly selectedCountryId: number | null;
  readonly messages: readonly DiplomacyMessageView[];
  readonly proposals: readonly DiplomacyProposalView[];
  readonly tradeProposals: readonly TradeProposalView[];
  readonly busy: DiplomacyBusyAction | null;
  readonly feedback: string | null;
}

export type NotificationKind =
  | 'warning' | 'combat' | 'completed' | 'diplomacy' | 'information';

export interface GameNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string;
  /** epoch ms */
  readonly at: number;
  /** When true the toast stays until dismissed (action-required); else it auto-expires. */
  readonly sticky?: boolean;
  /** World point this event happened at. When present the toast is clickable
   *  and re-centres the camera there (e.g. "force under attack"). */
  readonly focus?: { readonly x: number; readonly z: number };
  /** Number of identical events folded into this toast. Absent or 1 = a single
   *  event; >1 renders a "×N" tally so a burst does not stack up separate cards. */
  readonly count?: number;
}

export type CombatStatus = 'idle' | 'moving' | 'engaged' | 'retreating';

export interface ArmyUnitGroupView {
  readonly typeId: string;
  readonly label: string;
  readonly count: number;
  /** 0..1 */
  readonly health: number;
}

export interface ArmyStackView {
  readonly id: string;
  readonly country: string;
  readonly countryColor: string;
  readonly name: string;
  readonly unitCount: number;
  /** 0..1 */
  readonly strength: number;
  /** 0..1 */
  readonly health: number;
  /** 0..1. Organization/readiness — separate from health; low organization
   *  can force a retreat well before the stack is destroyed. */
  readonly organization?: number;
  /** 0..1. Grows while the stack holds ground; reduces incoming damage. */
  readonly entrenchment?: number;
  /** Combat posture; see game/units/army.ts ArmyStance. Own armies only. */
  readonly stance?: 'attack' | 'attack-defend' | 'defend' | 'defend-retreat' | 'retreat';
  /** Within reach of the owner's own territory. */
  readonly inSupply?: boolean;
  readonly selected: boolean;
  readonly combat: CombatStatus;
  /**
   * False for a foreign stack seen only at contact range — position and owner
   * are known, composition is not. The card shows an "unidentified" readout and
   * `unitCount` / `health` / `groups` carry no real data.
   */
  readonly identified?: boolean;
  /** Optional pending move order, world-space target. */
  readonly moveOrder?: { readonly x: number; readonly z: number } | null;
  /** Per-unit-type composition. */
  readonly groups?: readonly ArmyUnitGroupView[];
  /** World units per game-hour (slowest unit). */
  readonly speed?: number;
  /** Aggregate armor-specific firepower across every surviving troop. */
  readonly attack?: { readonly soft: number; readonly light: number; readonly heavy: number };
  readonly defense?: { readonly soft: number; readonly light: number; readonly heavy: number };
  /** Player-facing current activity, e.g. moving, extracting, or holding. */
  readonly activity: string;
  /** Current movement-leg estimate, when the army is marching. */
  readonly arrivalSeconds?: number;
  /** 0..1 progress through the current movement leg. */
  readonly movementProgress?: number;
  /** True when the player commands this stack (enables order buttons). */
  readonly own?: boolean;
  /** Which order buttons are currently valid. */
  readonly canExtract?: boolean;
  readonly extractableResources?: readonly ('food' | 'stone' | 'metal' | 'oil')[];
  /** UI is waiting for a map click to set the move destination. */
  readonly awaitingMoveTarget?: boolean;
  readonly targetingMode?: 'move' | 'attack' | 'retreat' | 'split' | null;
  readonly canMove?: boolean;
  /** Specific explanation shown when movement is unavailable. */
  readonly moveDisabledReason?: string;
  readonly canAttack?: boolean;
  readonly canRetreat?: boolean;
  readonly canSplit?: boolean;
  readonly canStop?: boolean;
  readonly shortage?: {
    severity: Record<'funds' | 'food' | 'metal' | 'oil', number>;
    modifiers: Record<'combatOutput' | 'movementSpeed' | 'visionRange' | 'extractionOutput' | 'organizationCap', number>;
  };
  readonly supply?: {
    readonly capacity: number;
    readonly stores: Readonly<Record<'funds' | 'food' | 'metal' | 'oil', number>>;
    readonly connected: boolean;
    readonly allocation: Readonly<Record<'funds' | 'food' | 'metal' | 'oil', number>>;
  };
  readonly legalRetreatExits?: ReadonlyArray<{
    firstNodeId: number; destinationProvinceId: number; x: number; z: number;
    readonly bearing?: string;
  }>;
  readonly battleFronts?: ReadonlyArray<{
    id: string; directionNodeId: number; role: 'attack' | 'defense';
    friendlyHp: number; friendlyBaselineHp: number; enemyHp: number; enemyBaselineHp: number;
    reinforcementCount: number;
    outgoingDamagePerGameHour: number; incomingDamagePerGameHour: number;
    friendlyCasualties: number; enemyCasualties: number;
    estimatedGameHours: number | null; estimatedRealSeconds: number | null;
    friendlyModifiers: {
      frontageUsed: number; frontageLimit: number; coordination: number; organization: number;
      stanceOutput: number; supply: number; protection: number; terrain: number; devastation: number;
    };
    enemyModifiers: {
      frontageUsed: number; frontageLimit: number; coordination: number; organization: number;
      stanceOutput: number; supply: number; protection: number; terrain: number; devastation: number;
    };
  }>;
  readonly artillery?: {
    range: number; targetArmyId: string | null; manualTarget: boolean;
  } | null;
}

export interface StrategicUiState {
  readonly phase: UiPhase;
  readonly playerCountry: PlayerCountry | null;
  readonly mapMode: MapMode;
  readonly clock: StrategicClock | null;
  readonly weather: WeatherState;
  readonly resources: readonly ResourceLine[];
  readonly selectedProvince: SelectedProvince | null;
  readonly selectedArmy: ArmyStackView | null;
  readonly notifications: readonly GameNotification[];
  /** One non-modal command drawer at a time; the map remains visible behind it. */
  readonly activeSidePanel: SidePanelId | null;
  readonly diplomacy: DiplomacyView;
  readonly market: { readonly busy: boolean; readonly feedback: string | null };
  readonly quality: QualityLevel;
  /** 0 = uncapped. Battery-saving opt-in, independent of graphics quality. */
  readonly frameRateCap: FrameRateCap;
  /** Backing-store scale actually in use (diagnostics / verification). */
  readonly effectiveRenderScale: number;
  readonly paused: boolean;
  /** Resource-deposit marker overlay toggle (off by default). */
  readonly resourceOverlay: boolean;
  /** Whether the debug/world-inspector affordances are exposed at all. */
  readonly debugEnabled: boolean;
  /** Progression tier — 1, 2, or 3. See game/phase.ts. Not to be confused
   *  with `phase` above (lobby/loading/in-game) — named distinctly for that
   *  reason. */
  readonly countryPhase?: number;
  readonly technology: TechnologyView;
}

/** Resources are declared up-front so the top bar has stable slots. */
export const DEFAULT_RESOURCES: readonly ResourceLine[] = [
  { id: 'money', label: 'Funds', value: null },
  { id: 'manpower', label: 'Manpower', value: null },
  { id: 'food', label: 'Food', value: null },
  { id: 'stone', label: 'Stone', value: null },
  { id: 'metal', label: 'Metal', value: null },
  { id: 'oil', label: 'Oil', value: null },
];

export function createInitialState(overrides: Partial<StrategicUiState> = {}): StrategicUiState {
  return {
    phase: 'lobby',
    playerCountry: null,
    mapMode: 'balanced',
    clock: null,
    weather: { raining: false, label: 'Clear' },
    resources: DEFAULT_RESOURCES,
    selectedProvince: null,
    selectedArmy: null,
    notifications: [],
    activeSidePanel: null,
    diplomacy: {
      viewerCountryId: null,
      countries: [],
      selectedCountryId: null,
      messages: [],
      proposals: [],
      tradeProposals: [],
      busy: null,
      feedback: null,
    },
    market: { busy: false, feedback: null },
    quality: 'high',
    frameRateCap: 0,
    effectiveRenderScale: 1,
    paused: false,
    resourceOverlay: false,
    debugEnabled: false,
    technology: {
      levels: { infantry: 1, resources: 1, resourceBuildings: 1, training: 1, hybrid: 1, armored: 1 },
      slots: [null, null],
      quotes: Object.fromEntries(['infantry', 'resources', 'resourceBuildings', 'training', 'hybrid', 'armored']
        .map((id) => [id, { hours: 6, cost: {}, affordable: true }])) as TechnologyView['quotes'],
    },
    ...overrides,
  };
}

export type UiListener = (state: StrategicUiState) => void;

export interface UiStore {
  get(): StrategicUiState;
  /** Shallow-merge a partial update and notify listeners (coalesced). */
  patch(update: Partial<StrategicUiState>): void;
  subscribe(listener: UiListener): () => void;
}

/**
 * Structural equality for the plain, JSON-shaped HUD state (resource lines,
 * the selected army/province card, queues — never more than a few dozen
 * fields). The 400ms HUD tick rebuilds these from scratch every time even
 * when nothing changed, so a reference check (`Object.is`) alone always sees
 * "changed" and defeats `patch`'s own gate below; this is what actually lets
 * unchanged data skip the render.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!valuesEqual(a[i], b[i])) return false;
    return true;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    if (!valuesEqual(aRecord[key], bRecord[key])) return false;
  }
  return true;
}

/**
 * Minimal event-driven store. Notifications are coalesced to one microtask so
 * a burst of `patch()` calls in the same frame produces a single render. No
 * per-frame polling, no layout reads.
 */
export function createUiStore(initial: StrategicUiState): UiStore {
  let state = initial;
  const listeners = new Set<UiListener>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    for (const listener of listeners) listener(state);
  };

  return {
    get: () => state,
    patch(update) {
      // Only merge keys that actually differ, and keep the existing reference
      // for the rest — a caller that recomputes an equal-but-freshly-allocated
      // object every tick (playerResourceLines, refreshSelectedArmy, ...) must
      // not force a render, and downstream code that memoizes on these
      // references stays stable too.
      let changed: Record<string, unknown> | null = null;
      for (const key of Object.keys(update) as Array<keyof StrategicUiState>) {
        if (valuesEqual(state[key], update[key])) continue;
        (changed ??= {})[key] = update[key];
      }
      if (!changed) return;
      state = { ...state, ...changed } as StrategicUiState;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
