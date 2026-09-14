import {
  RESOURCE_KEYS, relationOf,
  type GameState, type ResourceKey, type ResourceTradeProposal, type TradeLeg,
} from './game-state';
import type { CommandResult } from './commands/types';
import {
  isAlive, nextRecordId, samePair, validateCountries, validatePlayerRecipient,
} from './diplomacy';

export type MarketResource = Exclude<ResourceKey, 'funds'>;

/** Funds price to BUY one unit of the resource. Selling pays `MARKET_SELL_SPREAD`
 *  of this — a fixed, stateless spread (not a decaying/recovering rate): buying
 *  then immediately reselling always loses 25% of the funds spent, so there is
 *  no way to generate funds by round-tripping the market. */
export const MARKET_BUY_PRICE: Record<MarketResource, number> = {
  manpower: 6, food: 4, stone: 4, metal: 8, oil: 10,
};
export const MARKET_SELL_SPREAD = 0.75;
export const MARKET_MAX_TRADE_AMOUNT = 5_000;

function isMarketResource(resource: string): resource is MarketResource {
  return resource !== 'funds' && (RESOURCE_KEYS as readonly string[]).includes(resource);
}

export function marketTrade(
  state: GameState, countryId: number, action: 'buy' | 'sell', resource: MarketResource, amount: number,
): CommandResult {
  const country = state.countries[countryId];
  if (!country || !isAlive(state, countryId)) return { ok: false, reason: 'Your country is unavailable.' };
  if (!isMarketResource(resource)) return { ok: false, reason: 'Unknown resource.' };
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'Amount must be a positive whole number.' };
  if (amount > MARKET_MAX_TRADE_AMOUNT) {
    return { ok: false, reason: `Cannot trade more than ${MARKET_MAX_TRADE_AMOUNT} at once.` };
  }
  const price = MARKET_BUY_PRICE[resource];
  if (action === 'buy') {
    const cost = amount * price;
    if (country.stockpile.funds < cost) return { ok: false, reason: 'Insufficient funds.' };
    country.stockpile.funds -= cost;
    country.stockpile[resource] += amount;
    return { ok: true };
  }
  if (country.stockpile[resource] < amount) return { ok: false, reason: `Insufficient ${resource}.` };
  country.stockpile[resource] -= amount;
  country.stockpile.funds += amount * price * MARKET_SELL_SPREAD;
  return { ok: true };
}

export const MAX_TRADE_AMOUNT = 100_000;
export const MAX_TRADE_PROPOSALS_PER_PAIR = 20;

function validTradeLeg(leg: TradeLeg): boolean {
  return (RESOURCE_KEYS as readonly string[]).includes(leg.resource)
    && Number.isInteger(leg.amount) && leg.amount >= 0 && leg.amount <= MAX_TRADE_AMOUNT;
}

function trimTradeProposalHistory(state: GameState, fromCountryId: number, toCountryId: number): void {
  const proposals = state.resourceTradeProposals ?? {};
  const pair = Object.values(proposals).filter((proposal) => samePair(proposal, fromCountryId, toCountryId));
  if (pair.length <= MAX_TRADE_PROPOSALS_PER_PAIR) return;
  const resolvedOldestFirst = pair
    .filter((proposal) => proposal.status !== 'pending')
    .sort((a, b) => (a.resolvedAtTick ?? a.createdAtTick) - (b.resolvedAtTick ?? b.createdAtTick)
      || a.id.localeCompare(b.id));
  let excess = pair.length - MAX_TRADE_PROPOSALS_PER_PAIR;
  for (const proposal of resolvedOldestFirst) {
    if (excess <= 0) break;
    delete proposals[proposal.id];
    excess -= 1;
  }
}

export function proposeResourceTrade(
  state: GameState, fromCountryId: number, toCountryId: number, offer: TradeLeg, request: TradeLeg,
): CommandResult {
  const invalid = validatePlayerRecipient(state, fromCountryId, toCountryId);
  if (invalid) return invalid;
  if (relationOf(state, fromCountryId, toCountryId) !== 'allied') {
    return { ok: false, reason: 'Resource trades require an alliance.' };
  }
  if (!validTradeLeg(offer) || !validTradeLeg(request)) return { ok: false, reason: 'Invalid trade amount.' };
  if (offer.amount + request.amount <= 0) return { ok: false, reason: 'Offer at least one resource.' };

  const id = nextRecordId(state, 'trade');
  const proposal: ResourceTradeProposal = {
    id, fromCountryId, toCountryId, offer, request, status: 'pending', createdAtTick: state.simulationTick,
  };
  (state.resourceTradeProposals ??= {})[id] = proposal;
  trimTradeProposalHistory(state, fromCountryId, toCountryId);
  return { ok: true };
}

export function respondResourceTrade(
  state: GameState, respondingCountryId: number, proposalId: string, accept: boolean,
): CommandResult {
  const proposal = state.resourceTradeProposals?.[proposalId];
  if (!proposal) return { ok: false, reason: 'Trade proposal does not exist.' };
  if (proposal.toCountryId !== respondingCountryId) {
    return { ok: false, reason: 'Only the proposal recipient may respond.' };
  }
  if (proposal.status !== 'pending') return { ok: false, reason: 'Trade proposal is no longer pending.' };
  const invalid = validateCountries(state, proposal.fromCountryId, proposal.toCountryId);
  if (invalid) return invalid;

  if (!accept) {
    proposal.status = 'declined';
    proposal.resolvedAtTick = state.simulationTick;
    trimTradeProposalHistory(state, proposal.fromCountryId, proposal.toCountryId);
    return { ok: true };
  }

  if (relationOf(state, proposal.fromCountryId, proposal.toCountryId) !== 'allied') {
    return { ok: false, reason: 'No longer allied.' };
  }
  const proposer = state.countries[proposal.fromCountryId];
  const responder = state.countries[proposal.toCountryId];
  if (proposer.stockpile[proposal.offer.resource] < proposal.offer.amount) {
    return { ok: false, reason: `${proposer.name} can no longer afford this trade.` };
  }
  if (responder.stockpile[proposal.request.resource] < proposal.request.amount) {
    return { ok: false, reason: `${responder.name} can no longer afford this trade.` };
  }

  proposer.stockpile[proposal.offer.resource] -= proposal.offer.amount;
  proposer.stockpile[proposal.request.resource] += proposal.request.amount;
  responder.stockpile[proposal.request.resource] -= proposal.request.amount;
  responder.stockpile[proposal.offer.resource] += proposal.offer.amount;

  proposal.status = 'accepted';
  proposal.resolvedAtTick = state.simulationTick;
  trimTradeProposalHistory(state, proposal.fromCountryId, proposal.toCountryId);
  return { ok: true };
}
