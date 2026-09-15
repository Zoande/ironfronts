import { describe, expect, it } from 'vitest';
import { applyCommand, type CommandResult, type GameCommand } from '../../src/game/commands';
import {
  MARKET_BUY_PRICE, MARKET_MAX_TRADE_AMOUNT, MARKET_SELL_SPREAD, MAX_TRADE_AMOUNT, MAX_TRADE_PROPOSALS_PER_PAIR,
} from '../../src/game/trade';
import { GAME_STATE_VERSION, emptyStockpile, relationOf, setRelation, type GameState } from '../../src/game/game-state';
import type { SimContext } from '../../src/game/sim-context';

function state(): GameState {
  const country = (id: number, controller: 'player' | 'ai' = 'player') => ({
    id, name: `Country ${id}`, color: '#fff', controller,
    stockpile: { ...emptyStockpile(), funds: 10_000, metal: 500, oil: 500 }, income: emptyStockpile(), industryCapacity: 1,
  });
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: { 1: country(1), 2: country(2), 3: country(3, 'ai'), 4: country(4) },
    provinceOwners: { 10: 1, 20: 2, 30: 3 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {}, battles: {}, battleFronts: {}, resourceNodes: {}, relations: {},
    diplomacyMessages: {}, diplomacyProposals: {}, resourceTradeProposals: {}, nextDiplomacyId: 1,
    nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

function commandState(): { state: GameState; command: (command: GameCommand) => CommandResult } {
  const gameState = state();
  const context = { state: gameState } as unknown as SimContext;
  return { state: gameState, command: (command) => applyCommand(context, command) };
}

describe('market: buy/sell resources for funds', () => {
  it('buys and sells at the fixed price and spread, mutating both stockpiles', () => {
    const c = commandState();
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: 100 }).ok).toBe(true);
    expect(c.state.countries[1].stockpile.funds).toBe(10_000 - 100 * MARKET_BUY_PRICE.oil);
    expect(c.state.countries[1].stockpile.oil).toBe(600);

    const fundsBeforeSell = c.state.countries[1].stockpile.funds;
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'sell', resource: 'metal', amount: 200 }).ok).toBe(true);
    expect(c.state.countries[1].stockpile.metal).toBe(300);
    expect(c.state.countries[1].stockpile.funds).toBe(fundsBeforeSell + 200 * MARKET_BUY_PRICE.metal * MARKET_SELL_SPREAD);
  });

  it('never lets a buy-then-sell round trip create funds', () => {
    const c = commandState();
    const fundsBefore = c.state.countries[1].stockpile.funds;
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: 100 }).ok).toBe(true);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'sell', resource: 'oil', amount: 100 }).ok).toBe(true);
    expect(c.state.countries[1].stockpile.funds).toBeLessThan(fundsBefore);
  });

  it('rejects unaffordable, oversized, and malformed amounts without mutating anything', () => {
    const c = commandState();
    const before = { ...c.state.countries[1].stockpile };
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: 1_000_000 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'sell', resource: 'oil', amount: 1_000_000 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: MARKET_MAX_TRADE_AMOUNT + 1 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: 0 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: -5 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: 1.5 }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: Number.NaN }).ok).toBe(false);
    expect(c.command({ type: 'marketTrade', countryId: 1, action: 'buy', resource: 'oil', amount: Infinity }).ok).toBe(false);
    expect(c.state.countries[1].stockpile).toEqual(before);
  });
});

describe('ally-to-ally resource trade proposals', () => {
  it('requires an alliance to propose', () => {
    const c = commandState();
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 100 }, request: { resource: 'oil', amount: 100 },
    }).ok).toBe(false);
    expect(c.command({ type: 'declareWar', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 100 }, request: { resource: 'oil', amount: 100 },
    }).ok).toBe(false);
  });

  it('rejects self-target, dead/non-player targets, no-op offers, and out-of-range amounts', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    setRelation(c.state, 1, 3, 'allied');
    setRelation(c.state, 1, 4, 'allied');
    const legs = { offer: { resource: 'metal' as const, amount: 100 }, request: { resource: 'oil' as const, amount: 100 } };
    expect(c.command({ type: 'proposeResourceTrade', countryId: 1, targetCountryId: 1, ...legs }).ok).toBe(false);
    expect(c.command({ type: 'proposeResourceTrade', countryId: 1, targetCountryId: 3, ...legs }).ok).toBe(false); // AI, not a player
    expect(c.command({ type: 'proposeResourceTrade', countryId: 1, targetCountryId: 4, ...legs }).ok).toBe(false); // dead
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 0 }, request: { resource: 'oil', amount: 0 },
    }).ok).toBe(false);
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: MAX_TRADE_AMOUNT + 1 }, request: { resource: 'oil', amount: 0 },
    }).ok).toBe(false);
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: -1 }, request: { resource: 'oil', amount: 0 },
    }).ok).toBe(false);
    expect(Object.values(c.state.resourceTradeProposals ?? {})).toHaveLength(0);
  });

  it('atomically transfers both legs on accept and rejects a second response', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 150 }, request: { resource: 'oil', amount: 80 },
    }).ok).toBe(true);
    const proposal = Object.values(c.state.resourceTradeProposals ?? {})[0];

    expect(c.command({ type: 'respondResourceTrade', countryId: 1, proposalId: proposal.id, accept: true }).ok).toBe(false); // not the recipient

    c.state.simulationTick = 5;
    expect(c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: proposal.id, accept: true }).ok).toBe(true);
    expect(c.state.countries[1].stockpile).toMatchObject({ metal: 350, oil: 580 });
    expect(c.state.countries[2].stockpile).toMatchObject({ metal: 650, oil: 420 });
    expect(proposal).toMatchObject({ status: 'accepted', resolvedAtTick: 5 });

    expect(c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: proposal.id, accept: true }).ok).toBe(false);
  });

  it('declines without mutating any stockpile', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 150 }, request: { resource: 'oil', amount: 80 },
    }).ok).toBe(true);
    const proposal = Object.values(c.state.resourceTradeProposals ?? {})[0];
    const before1 = { ...c.state.countries[1].stockpile };
    const before2 = { ...c.state.countries[2].stockpile };
    expect(c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: proposal.id, accept: false }).ok).toBe(true);
    expect(proposal.status).toBe('declined');
    expect(c.state.countries[1].stockpile).toEqual(before1);
    expect(c.state.countries[2].stockpile).toEqual(before2);
  });

  it('withdraws a pending trade offer the moment the alliance it depends on ends', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 150 }, request: { resource: 'oil', amount: 80 },
    }).ok).toBe(true);
    const proposal = Object.values(c.state.resourceTradeProposals ?? {})[0];
    expect(c.command({ type: 'endAlliance', countryId: 1, targetCountryId: 2 }).ok).toBe(true);
    expect(proposal.status).toBe('withdrawn');
    expect(c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: proposal.id, accept: true }).ok).toBe(false);
  });

  it('rejects acceptance — without mutating stockpiles or resolving the proposal — once a side can no longer afford it', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    expect(c.command({
      type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
      offer: { resource: 'metal', amount: 400 }, request: { resource: 'oil', amount: 80 },
    }).ok).toBe(true);
    const proposal = Object.values(c.state.resourceTradeProposals ?? {})[0];
    // Country 1 spends its metal on something else before country 2 answers.
    c.state.countries[1].stockpile.metal = 10;
    const before1 = { ...c.state.countries[1].stockpile };
    const before2 = { ...c.state.countries[2].stockpile };

    const result = c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: proposal.id, accept: true });
    expect(result.ok).toBe(false);
    expect(c.state.countries[1].stockpile).toEqual(before1);
    expect(c.state.countries[2].stockpile).toEqual(before2);
    expect(proposal.status).toBe('pending');
  });

  it('bounds resolved proposal history while retaining transitions', () => {
    const c = commandState();
    setRelation(c.state, 1, 2, 'allied');
    for (let index = 0; index < MAX_TRADE_PROPOSALS_PER_PAIR + 2; index += 1) {
      c.state.simulationTick = index * 2;
      expect(c.command({
        type: 'proposeResourceTrade', countryId: 1, targetCountryId: 2,
        offer: { resource: 'metal', amount: 1 }, request: { resource: 'oil', amount: 0 },
      }).ok).toBe(true);
      const pending = Object.values(c.state.resourceTradeProposals ?? {})
        .find((proposal) => proposal.status === 'pending')!;
      expect(c.command({ type: 'respondResourceTrade', countryId: 2, proposalId: pending.id, accept: false }).ok).toBe(true);
    }
    expect(Object.values(c.state.resourceTradeProposals ?? {})).toHaveLength(MAX_TRADE_PROPOSALS_PER_PAIR);
  });
});

it('setRelation and relationOf agree on the allied round trip used by these tests', () => {
  const s = state();
  setRelation(s, 1, 2, 'allied');
  expect(relationOf(s, 1, 2)).toBe('allied');
});
