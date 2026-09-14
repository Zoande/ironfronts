import { describe, expect, it } from 'vitest';
import {
  clientMessageSchema, commandPayloadSchema, GAME_ID, PROTOCOL_VERSION, serverMessageSchema,
} from '../../packages/protocol/src/index';
import { signGameTicket, verifyGameTicket } from '../../packages/protocol/src/ticket';
import { TicketNonceStore } from '../../apps/game-server/src/ticket-nonces';

const secret = 'a sufficiently long test secret';
const claims = {
  accountId: 'account-1', gameId: GAME_ID, countryId: 7,
  audience: 'game-server' as const, protocolVersion: PROTOCOL_VERSION,
  expiresAt: Date.now() + 30_000, nonce: 'nonce-1',
};

describe('game tickets and command wire schema', () => {
  it('verifies valid signed claims and rejects tampering, expiry, and audience mismatch', () => {
    expect(verifyGameTicket(signGameTicket(claims, secret), secret)).toEqual(claims);
    expect(() => verifyGameTicket(`${signGameTicket(claims, secret)}x`, secret)).toThrow(/signature/i);
    expect(() => verifyGameTicket(signGameTicket({ ...claims, expiresAt: Date.now() - 1 }, secret), secret)).toThrow(/expired/i);
    expect(() => verifyGameTicket(signGameTicket({ ...claims, audience: 'other' as never }, secret), secret)).toThrow(/audience/i);
  });

  it('strips forged ownership fields from network commands', () => {
    const parsed = commandPayloadSchema.parse({ type: 'stopArmy', armyId: 'army-1', countryId: 999 });
    expect(parsed).toEqual({ type: 'stopArmy', armyId: 'army-1' });
    expect('countryId' in parsed).toBe(false);
  });

  it('accepts typed v3 attack, retreat, and split commands', () => {
    expect(commandPayloadSchema.parse({
      type: 'attackArmy', armyId: 'army-1', target: { kind: 'army', armyId: 'army-2' },
    })).toMatchObject({ target: { kind: 'army', armyId: 'army-2' } });
    expect(commandPayloadSchema.parse({
      type: 'retreatArmy', armyId: 'army-1', x: 700, z: 900,
    }).type).toBe('retreatArmy');
    expect(commandPayloadSchema.parse({
      type: 'splitArmy', armyId: 'army-1', groups: [{ typeId: 'infantry', count: 2 }],
      x: 10, z: 20,
    }).type).toBe('splitArmy');
  });

  it('validates diplomacy commands and strips forged sender ids', () => {
    expect(commandPayloadSchema.parse({
      type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'Hello', countryId: 999,
    })).toEqual({ type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'Hello' });
    expect(commandPayloadSchema.parse({
      type: 'proposeDiplomacy', targetCountryId: 2, proposal: 'alliance', countryId: 999,
    })).toEqual({ type: 'proposeDiplomacy', targetCountryId: 2, proposal: 'alliance' });
    expect(commandPayloadSchema.parse({
      type: 'respondDiplomacy', proposalId: 'proposal-1', accept: true, countryId: 999,
    })).toEqual({ type: 'respondDiplomacy', proposalId: 'proposal-1', accept: true });
    expect(commandPayloadSchema.parse({
      type: 'declareWar', targetCountryId: 2, countryId: 999,
    })).toEqual({ type: 'declareWar', targetCountryId: 2 });
    expect(commandPayloadSchema.parse({
      type: 'endAlliance', targetCountryId: 2, countryId: 999,
    })).toEqual({ type: 'endAlliance', targetCountryId: 2 });
    expect(() => commandPayloadSchema.parse({
      type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'x'.repeat(501),
    })).toThrow();
    expect(() => commandPayloadSchema.parse({
      type: 'proposeDiplomacy', targetCountryId: 2, proposal: 'surrender',
    })).toThrow();
  });

  it('validates visual-clock, weather, and cheat controls', () => {
    expect(clientMessageSchema.parse({ type: 'devSetClock', epochMs: 13.5 }))
      .toEqual({ type: 'devSetClock', epochMs: 13.5 });
    expect(clientMessageSchema.parse({ type: 'devLinkClockTimezone', timeZone: 'Europe/Amsterdam' }))
      .toEqual({ type: 'devLinkClockTimezone', timeZone: 'Europe/Amsterdam' });
    expect(clientMessageSchema.parse({ type: 'devSetWeather', mode: 'automatic' }))
      .toEqual({ type: 'devSetWeather', mode: 'automatic' });
    expect(serverMessageSchema.parse({
      type: 'devDiagnostics', requestedSpeed: 100, effectiveSpeed: 99.5,
      pendingSimulationSeconds: 0, lastPumpSteps: 2, lastPumpMilliseconds: 1,
      overloaded: false, devControlsEnabled: true,
    })).toMatchObject({ type: 'devDiagnostics', requestedSpeed: 100 });
    expect(clientMessageSchema.parse({ type: 'devCheatBuild', provinceId: 4, buildingId: 'mine', level: 5 }))
      .toMatchObject({ type: 'devCheatBuild', level: 5 });
  });

  it('accepts bounded browser diagnostics and rejects structured payload injection', () => {
    expect(clientMessageSchema.parse({
      type: 'clientDiagnostic', level: 'warn', event: 'revision_mismatch',
      clientEpochMs: 123, fields: { localRevision: 4, online: true, reason: null },
    })).toMatchObject({ type: 'clientDiagnostic', event: 'revision_mismatch' });
    expect(clientMessageSchema.safeParse({
      type: 'clientDiagnostic', level: 'info', event: 'bad', clientEpochMs: 123,
      fields: { nested: { secret: 'not accepted' } },
    }).success).toBe(false);
  });

  it('requires kind-specific event identity and ownership fields', () => {
    const envelope = (event: unknown) => ({ type: 'delta', fromRevision: 0, revision: 1,
      delta: { changed: {}, upserts: {}, removals: {}, redactions: [] }, events: [event] });
    expect(serverMessageSchema.safeParse(envelope({ id: 'event-1', kind: 'unitCompleted', provinceId: 2, unitTypeId: 'infantry' })).success).toBe(false);
    expect(serverMessageSchema.safeParse(envelope({ id: 'event-1', kind: 'unitCompleted', ownerCountryId: 1,
      provinceId: 2, unitTypeId: 'infantry', armyId: 'army-3', x: 10, z: 20 })).success).toBe(true);
    expect(serverMessageSchema.safeParse(envelope({ id: 'event-2', kind: 'engaged', attacker: 1, defender: 2,
      battleId: 'battle-1', frontId: 'front-1' })).success).toBe(false);
    expect(serverMessageSchema.safeParse(envelope({ id: 'event-2', kind: 'engaged', attacker: 1, defender: 2,
      battleId: 'battle-1', frontId: 'front-1', x: 10, z: 20 })).success).toBe(true);
  });

  it('accepts a ticket nonce once and rejects replay', () => {
    const nonces = new TicketNonceStore();
    expect(nonces.consume('one-time', Date.now() + 10_000)).toBe(true);
    expect(nonces.consume('one-time', Date.now() + 10_000)).toBe(false);
  });
});
