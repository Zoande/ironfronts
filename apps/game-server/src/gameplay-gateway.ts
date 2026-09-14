/** Gameplay WebSocket transport: upgrades, authentication, commands, and connections. */

import type { Server as HttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION, clientMessageSchema,
  type PlayerProjection, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { verifyGameTicket } from '@ironfronts/protocol/ticket';
import type { GameRuntime } from './runtime';
import type { AuthoritativeGameClock } from './game-clock';
import { TicketNonceStore } from './ticket-nonces';

const DEBUG_MESSAGE_TYPES = new Set([
  'devSetSimSpeed', 'devSetClock', 'devLinkClockTimezone', 'devSetWeather',
  'devCheatBuild', 'devCheatSpawnUnit', 'devCheatGiveResource',
]);

function requestedMessageType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  return typeof value.type === 'string' ? value.type : null;
}

function passwordMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GameplayConnection {
  readonly socket: WebSocket;
  readonly accountId: string;
  readonly countryId: number;
  readonly debugEntitled: boolean;
  debugEnabled: boolean;
  projection: PlayerProjection;
  revision: number;
}

export interface GameplayGatewayOptions {
  readonly server: HttpServer;
  readonly runtime: GameRuntime;
  readonly clientOrigin: string;
  readonly ticketSecret: string;
  /** Deployment gate; a signed account entitlement and password are also required. */
  readonly debugControlsEnabled: boolean;
  readonly debugPassword: string;
  readonly world: WorldDescriptor;
  readonly clock: AuthoritativeGameClock;
  readonly revision: () => number;
  readonly publishNow: () => void;
  readonly beforeDebugChange: () => void;
  readonly saveGameInBackground: () => void;
  readonly devSimSpeed: { get(): number; set(multiplier: number): void; enabled: boolean };
  readonly devDiagnostics: { get(): {
    requestedSpeed: number; effectiveSpeed: number; pendingSimulationSeconds: number;
    lastPumpSteps: number; lastPumpMilliseconds: number; overloaded: boolean;
  } };
  readonly log: (
    level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>,
  ) => void;
}

export class GameplayGateway {
  readonly connections = new Set<GameplayConnection>();

  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768 });
  private readonly usedNonces = new TicketNonceStore();
  private readonly recentCommands = new Map<string, Map<string, ServerMessage>>();

  constructor(private readonly options: GameplayGatewayOptions) {
    options.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/v2/game' || request.headers.origin !== options.clientOrigin) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(
        request, socket, head,
        (webSocket) => this.sockets.emit('connection', webSocket, request),
      );
    });
    this.sockets.on('connection', (socket) => this.handleConnection(socket));
  }

  send(connection: GameplayConnection, message: ServerMessage): boolean {
    return this.sendSocket(connection.socket, message);
  }

  broadcast(message: ServerMessage): void {
    for (const connection of this.connections) this.send(connection, message);
  }

  private sendDebugState(connection: GameplayConnection): void {
    this.send(connection, {
      type: 'devSimSpeed', multiplier: this.options.devSimSpeed.get(),
      devControlsEnabled: connection.debugEnabled,
    });
    this.send(connection, {
      type: 'devDiagnostics', ...this.options.devDiagnostics.get(),
      devControlsEnabled: connection.debugEnabled,
    });
  }

  broadcastDebugState(): void {
    for (const connection of this.connections) this.sendDebugState(connection);
  }

  closeAll(code = 1001, reason = 'Server shutting down'): void {
    for (const socket of this.sockets.clients) socket.close(code, reason);
    this.sockets.close();
  }

  private sendSocket(socket: WebSocket, message: ServerMessage): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 2_000_000) { socket.close(1013, 'Resynchronize slow connection'); return false; }
    socket.send(JSON.stringify(message));
    return true;
  }

  private handleConnection(socket: WebSocket): void {
    let connection: GameplayConnection | null = null;
    const authenticationTimeout = setTimeout(() => {
      if (!connection) {
        this.sendSocket(socket, {
          type: 'error', code: 'authentication_required',
          message: 'Authenticate before using the game connection.',
        });
        socket.close(4401, 'Authentication required');
      }
    }, 5_000);

    socket.on('message', (data) => {
      try {
        const raw: unknown = JSON.parse(data.toString());
        const requestedType = requestedMessageType(raw);
        if (!connection && requestedType && (requestedType === 'devUnlockDebug' || DEBUG_MESSAGE_TYPES.has(requestedType))) {
          this.sendSocket(socket, {
            type: 'error', code: 'authentication_required',
            message: 'Authenticate before using the game connection.',
          });
          return;
        }
        if (connection && requestedType && DEBUG_MESSAGE_TYPES.has(requestedType)
          && !connection.debugEnabled) {
          this.sendSocket(socket, {
            type: 'error', code: 'unauthorized_debug',
            message: 'Debug controls are disabled on this deployment.',
          });
          return;
        }
        const message = clientMessageSchema.parse(raw);
        if (message.type === 'authenticate') {
          if (connection) throw new Error('Connection is already authenticated.');
          const claims = verifyGameTicket(message.ticket, this.options.ticketSecret);
          if (claims.gameId !== GAME_ID) throw new Error('Ticket is for a different game.');
          if (!this.usedNonces.consume(claims.nonce, claims.expiresAt)) {
            throw new Error('Game ticket has already been used.');
          }
          if (this.options.runtime.seat(claims.accountId) !== claims.countryId) {
            throw new Error('Ticket does not match the authoritative seat.');
          }
          clearTimeout(authenticationTimeout);
          const debugEntitled = this.options.debugControlsEnabled && claims.debugEntitled === true;
          const debugEnabled = false;
          const revision = this.options.revision();
          const projection = this.options.runtime.projection(
            claims.countryId, this.options.devSimSpeed.get(), false,
          );
          connection = {
            socket, accountId: claims.accountId, countryId: claims.countryId,
            debugEntitled, debugEnabled, projection, revision,
          };
          this.connections.add(connection);
          this.sendSocket(socket, {
            type: 'hello', gameId: GAME_ID, gameVersion: GAME_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            capabilities: [
              'filtered-baseline', 'change-only-deltas', 'resync',
              'pending-commands', 'authoritative-timeline',
            ],
            world: this.options.world,
            countryId: claims.countryId,
            debugEnabled,
            debugUnlockAvailable: debugEntitled,
          });
          this.sendSocket(socket, {
            type: 'baseline', revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          this.sendDebugState(connection);
          this.options.log('info', 'client_connected', { countryId: claims.countryId });
          return;
        }
        if (!connection) {
          this.sendSocket(socket, {
            type: 'error', code: 'authentication_required',
            message: 'Authenticate before using the game connection.',
          });
          return;
        }
        if (message.type === 'ping') {
          this.sendSocket(socket, { type: 'pong', sentAt: message.sentAt, serverEpochMs: Date.now() }); return;
        }
        if (message.type === 'devUnlockDebug') {
          if (!connection.debugEntitled) {
            this.sendSocket(socket, {
              type: 'error', code: 'unauthorized_debug',
              message: 'This account is not entitled to debug controls.',
            });
            return;
          }
          if (!passwordMatches(message.password, this.options.debugPassword)) {
            this.options.log('warn', 'debug_unlock_failed', { accountId: connection.accountId, countryId: connection.countryId });
            this.send(connection, { type: 'devDebugAccess', enabled: false, message: 'Incorrect debug password.' });
            return;
          }
          if (!connection.debugEnabled) {
            connection.debugEnabled = true;
            connection.revision = this.options.revision();
            connection.projection = this.options.runtime.projection(
              connection.countryId, this.options.devSimSpeed.get(), true,
            );
            this.send(connection, {
              type: 'baseline', revision: connection.revision, state: connection.projection,
              catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
            });
            this.options.log('info', 'debug_unlocked', { accountId: connection.accountId, countryId: connection.countryId });
          }
          this.send(connection, { type: 'devDebugAccess', enabled: true, message: 'World Inspector unlocked.' });
          this.sendDebugState(connection);
          return;
        }
        if (message.type === 'devSetSimSpeed' || message.type === 'devSetClock' || message.type === 'devLinkClockTimezone') {
          if (!connection.debugEnabled) {
            this.sendSocket(socket, {
              type: 'error', code: 'unauthorized_debug',
              message: 'Debug controls are disabled on this deployment.',
            });
            return;
          }
          this.options.beforeDebugChange();
          if (message.type === 'devSetSimSpeed') this.options.devSimSpeed.set(message.multiplier);
          else if (message.type === 'devSetClock') this.options.clock.setEpoch(message.epochMs);
          else this.options.clock.linkTimezone(message.timeZone);
          this.options.publishNow();
          this.broadcast({ type: 'clockSync', clock: this.options.clock.snapshot() });
          this.options.saveGameInBackground();
          this.broadcastDebugState();
          return;
        }
        if (message.type === 'devSetWeather') {
          this.options.runtime.setWeatherMode(message.mode);
          this.options.publishNow();
          this.options.saveGameInBackground();
          return;
        }
        if (message.type === 'devCheatBuild' || message.type === 'devCheatSpawnUnit'
          || message.type === 'devCheatGiveResource') {
          const result = message.type === 'devCheatBuild'
            ? this.options.runtime.cheatBuild(message.provinceId, message.buildingId, message.level)
            : message.type === 'devCheatSpawnUnit'
              ? this.options.runtime.cheatSpawnUnit(message.provinceId, message.countryId, message.unitTypeId)
              : this.options.runtime.cheatGiveResource(message.countryId, message.resource, message.amount);
          const action = message.type === 'devCheatBuild' ? 'build'
            : message.type === 'devCheatSpawnUnit' ? 'spawn' : 'resource';
          this.options.log(result.ok ? 'info' : 'warn', 'debug_cheat', {
            action, accountId: connection.accountId, countryId: connection.countryId, result: result.message,
          });
          if (result.ok) {
            this.options.publishNow();
            this.options.saveGameInBackground();
          }
          this.send(connection, { type: 'devCheatResult', action, ...result });
          return;
        }
        if (message.type === 'resync') {
          const projection = this.options.runtime.projection(
            connection.countryId, this.options.devSimSpeed.get(), connection.debugEnabled,
          );
          connection.projection = projection;
          connection.revision = this.options.revision();
          this.sendSocket(socket, {
            type: 'baseline', revision: connection.revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          return;
        }

        const accountCommands = this.recentCommands.get(connection.accountId)
          ?? new Map<string, ServerMessage>();
        this.recentCommands.set(connection.accountId, accountCommands);
        const existing = accountCommands.get(message.commandId);
        if (existing) {
          this.sendSocket(socket, existing);
          return;
        }
        const result = this.options.runtime.command(connection.countryId, message.command);
        if (result.ok) { this.options.publishNow(); this.options.saveGameInBackground(); }
        const acknowledgement: ServerMessage = {
          type: 'commandAck', commandId: message.commandId, ok: result.ok,
          ...(result.ok ? { appliedRevision: connection.revision } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.requiredWarCountryIds?.length
            ? { requiredWarCountryIds: result.requiredWarCountryIds } : {}),
        };
        accountCommands.set(message.commandId, acknowledgement);
        if (accountCommands.size > 256) accountCommands.delete(accountCommands.keys().next().value!);
        this.sendSocket(socket, acknowledgement);
      } catch (error) {
        this.sendSocket(socket, {
          type: 'error', code: 'invalid_message',
          message: error instanceof Error ? error.message : 'Invalid message.',
        });
      }
    });
    socket.on('error', (error) => this.options.log('warn', 'socket_error', { message: error.message }));
    socket.on('close', () => {
      clearTimeout(authenticationTimeout);
      if (connection) this.connections.delete(connection);
    });
  }
}
