import {
  relationKey, relationOf, setRelation,
  type DiplomacyMessage, type DiplomacyProposal, type GameState,
} from './game-state';
import type { CommandResult } from './commands/types';

export const MAX_DIPLOMACY_MESSAGE_LENGTH = 500;
export const MAX_DIPLOMACY_MESSAGES_PER_PAIR = 50;
export const MAX_DIPLOMACY_PROPOSALS_PER_PAIR = 50;

export function isAlive(state: GameState, countryId: number): boolean {
  return Object.values(state.provinceOwners).some((ownerId) => ownerId === countryId);
}

export function validateCountries(
  state: GameState, fromCountryId: number, toCountryId: number,
): CommandResult | null {
  if (fromCountryId === toCountryId) return { ok: false, reason: 'Cannot target your own country.' };
  if (!state.countries[fromCountryId] || !isAlive(state, fromCountryId)) {
    return { ok: false, reason: 'Your country is unavailable.' };
  }
  if (!state.countries[toCountryId] || !isAlive(state, toCountryId)) {
    return { ok: false, reason: 'Target country is unavailable.' };
  }
  return null;
}

export function validatePlayerRecipient(
  state: GameState, fromCountryId: number, toCountryId: number,
): CommandResult | null {
  const invalid = validateCountries(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  if (state.countries[toCountryId].controller !== 'player') {
    return { ok: false, reason: 'Target country is not controlled by a player.' };
  }
  return null;
}

export function nextRecordId(state: GameState, prefix: 'message' | 'proposal' | 'trade'): string {
  if (state.nextDiplomacyId === undefined) {
    const ids = [
      ...Object.keys(state.diplomacyMessages ?? {}),
      ...Object.keys(state.diplomacyProposals ?? {}),
      ...Object.keys(state.resourceTradeProposals ?? {}),
    ];
    state.nextDiplomacyId = ids.reduce((next, id) => {
      const suffix = Number(id.slice(id.lastIndexOf('-') + 1));
      return Number.isSafeInteger(suffix) ? Math.max(next, suffix + 1) : next;
    }, 1);
  }
  const sequence = state.nextDiplomacyId;
  state.nextDiplomacyId += 1;
  return `${prefix}-${sequence}`;
}

export function samePair(
  a: { fromCountryId: number; toCountryId: number },
  fromCountryId: number,
  toCountryId: number,
): boolean {
  return relationKey(a.fromCountryId, a.toCountryId) === relationKey(fromCountryId, toCountryId);
}

function trimMessageHistory(state: GameState, fromCountryId: number, toCountryId: number): void {
  const messages = state.diplomacyMessages ?? {};
  const pair = Object.values(messages)
    .filter((message) => samePair(message, fromCountryId, toCountryId))
    .sort((a, b) => b.sentAtTick - a.sentAtTick || b.id.localeCompare(a.id));
  for (const message of pair.slice(MAX_DIPLOMACY_MESSAGES_PER_PAIR)) delete messages[message.id];
}

function trimProposalHistory(state: GameState, fromCountryId: number, toCountryId: number): void {
  const proposals = state.diplomacyProposals ?? {};
  const pair = Object.values(proposals)
    .filter((proposal) => samePair(proposal, fromCountryId, toCountryId));
  if (pair.length <= MAX_DIPLOMACY_PROPOSALS_PER_PAIR) return;
  const resolvedOldestFirst = pair
    .filter((proposal) => proposal.status !== 'pending')
    .sort((a, b) => (a.resolvedAtTick ?? a.createdAtTick) - (b.resolvedAtTick ?? b.createdAtTick)
      || a.id.localeCompare(b.id));
  let excess = pair.length - MAX_DIPLOMACY_PROPOSALS_PER_PAIR;
  for (const proposal of resolvedOldestFirst) {
    if (excess <= 0) break;
    delete proposals[proposal.id];
    excess -= 1;
  }
}

export function sendDiplomaticMessage(
  state: GameState, fromCountryId: number, toCountryId: number, body: string,
): CommandResult {
  const invalid = validatePlayerRecipient(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: 'Message cannot be empty.' };
  if (trimmed.length > MAX_DIPLOMACY_MESSAGE_LENGTH) {
    return { ok: false, reason: `Message cannot exceed ${MAX_DIPLOMACY_MESSAGE_LENGTH} characters.` };
  }
  const id = nextRecordId(state, 'message');
  const message: DiplomacyMessage = {
    id, fromCountryId, toCountryId, body: trimmed, sentAtTick: state.simulationTick,
  };
  (state.diplomacyMessages ??= {})[id] = message;
  trimMessageHistory(state, fromCountryId, toCountryId);
  return { ok: true };
}

export function proposeDiplomacy(
  state: GameState,
  fromCountryId: number,
  toCountryId: number,
  kind: DiplomacyProposal['kind'],
): CommandResult {
  const invalid = validatePlayerRecipient(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  const relation = relationOf(state, fromCountryId, toCountryId);
  if (kind === 'alliance' && relation !== 'peace') {
    return { ok: false, reason: 'Alliance proposals require a peaceful relationship.' };
  }
  if (kind === 'peace' && relation !== 'war') {
    return { ok: false, reason: 'Peace proposals require an active war.' };
  }
  const proposals = state.diplomacyProposals ??= {};
  const duplicate = Object.values(proposals).some((proposal) => proposal.status === 'pending'
    && proposal.kind === kind && samePair(proposal, fromCountryId, toCountryId));
  if (duplicate) return { ok: false, reason: 'A matching proposal is already pending.' };

  const id = nextRecordId(state, 'proposal');
  proposals[id] = {
    id, fromCountryId, toCountryId, kind, status: 'pending', createdAtTick: state.simulationTick,
  };
  trimProposalHistory(state, fromCountryId, toCountryId);
  return { ok: true };
}

export function respondDiplomacy(
  state: GameState, respondingCountryId: number, proposalId: string, accept: boolean,
): CommandResult {
  const proposal = state.diplomacyProposals?.[proposalId];
  if (!proposal) return { ok: false, reason: 'Diplomacy proposal does not exist.' };
  if (proposal.toCountryId !== respondingCountryId) {
    return { ok: false, reason: 'Only the proposal recipient may respond.' };
  }
  if (proposal.status !== 'pending') return { ok: false, reason: 'Diplomacy proposal is no longer pending.' };
  if (!state.countries[respondingCountryId] || !isAlive(state, respondingCountryId)) {
    return { ok: false, reason: 'Your country is unavailable.' };
  }
  if (accept && (!state.countries[proposal.fromCountryId] || !isAlive(state, proposal.fromCountryId))) {
    return { ok: false, reason: 'Proposing country is unavailable.' };
  }

  proposal.status = accept ? 'accepted' : 'declined';
  proposal.resolvedAtTick = state.simulationTick;
  if (accept) {
    setRelation(
      state, proposal.fromCountryId, proposal.toCountryId,
      proposal.kind === 'alliance' ? 'allied' : 'peace',
    );
  }
  trimProposalHistory(state, proposal.fromCountryId, proposal.toCountryId);
  return { ok: true };
}

export function declareWar(
  state: GameState, fromCountryId: number, toCountryId: number,
): CommandResult {
  const invalid = validateCountries(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  setRelation(state, fromCountryId, toCountryId, 'war');
  trimProposalHistory(state, fromCountryId, toCountryId);
  return { ok: true };
}

export function endAlliance(
  state: GameState, fromCountryId: number, toCountryId: number,
): CommandResult {
  const invalid = validateCountries(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  if (relationOf(state, fromCountryId, toCountryId) !== 'allied') {
    return { ok: false, reason: 'Countries are not allied.' };
  }
  setRelation(state, fromCountryId, toCountryId, 'peace');
  return { ok: true };
}
