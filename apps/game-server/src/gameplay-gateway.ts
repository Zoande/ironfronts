/** Gameplay WebSocket transport: upgrades, authentication, commands, and connections. */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
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
const BACKPRESSURE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
const BACKPRESSURE_GRACE_MILLISECONDS = 10_000;

function requestedMessageType(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  return typeof value.type === 'string' ? value.type : null;
}

export interface GameplayConnection {
  readonly socket: WebSocket;
  readonly accountId: string;
  readonly countryId: number;
  readonly debugEnabled: boolean;
  projection: PlayerProjection;
  revision: number;
}

export interface GameplayGatewayOptions {
  readonly server: HttpServer;
  readonly runtime: GameRuntime;
  readonly clientOrigin: string;
  readonly ticketSecret: string;
  /** Explicit deployment gate. Debug access is intentionally account-agnostic. */
  readonly debugControlsEnabled: boolean;
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
  readonly clientLog?: (
    level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>,
  ) => void;
}

export class GameplayGateway {
  readonly connections = new Set<GameplayConnection>();

  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 32_768 });
  private readonly usedNonces = new TicketNonceStore();
  private readonly recentCommands = new Map<string, Map<string, ServerMessage>>();
  private readonly socketIds = new WeakMap<WebSocket, number>();
  private readonly backpressureStartedAt = new WeakMap<WebSocket, number>();
  private readonly skippedSendLogged = new WeakSet<WebSocket>();
  private nextSocketId = 1;

  constructor(private readonly options: GameplayGatewayOptions) {
    options.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/v2/game' || request.headers.origin !== options.clientOrigin) {
        options.log('warn', 'websocket_upgrade_rejected', {
          path: url.pathname, origin: request.headers.origin ?? null,
          remoteAddress: request.socket.remoteAddress ?? null,
        });
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.sockets.handleUpgrade(
        request, socket, head,
        (webSocket) => this.sockets.emit('connection', webSocket, request),
      );
    });
    this.sockets.on('connection', (socket, request) => this.handleConnection(socket, request));
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
    if (socket.readyState !== WebSocket.OPEN) {
      if (!this.skippedSendLogged.has(socket)) {
        this.skippedSendLogged.add(socket);
        this.options.log('warn', 'websocket_send_skipped', {
          socketId: this.socketIds.get(socket) ?? null,
          messageType: message.type, readyState: socket.readyState, bufferedAmount: socket.bufferedAmount,
        });
      }
      return false;
    }
    const now = performance.now();
    if (socket.bufferedAmount > BACKPRESSURE_SOFT_LIMIT_BYTES) {
      const startedAt = this.backpressureStartedAt.get(socket);
      if (startedAt === undefined) {
        this.backpressureStartedAt.set(socket, now);
        this.options.log('warn', 'websocket_backpressure_started', {
          socketId: this.socketIds.get(socket) ?? null,
          messageType: message.type, bufferedAmount: socket.bufferedAmount,
          softLimitBytes: BACKPRESSURE_SOFT_LIMIT_BYTES,
        });
      } else if (now - startedAt >= BACKPRESSURE_GRACE_MILLISECONDS) {
        this.options.log('warn', 'websocket_backpressure_close', {
          socketId: this.socketIds.get(socket) ?? null,
          messageType: message.type, bufferedAmount: socket.bufferedAmount,
          durationMilliseconds: now - startedAt,
        });
        socket.close(1013, 'Resynchronize slow connection');
      }
      // Do not add more data while the transport drains. ProjectionPublisher
      // retains the connection's old projection and will send one catch-up
      // delta after recovery.
      return false;
    }
    const backpressureAt = this.backpressureStartedAt.get(socket);
    if (backpressureAt !== undefined) {
      this.backpressureStartedAt.delete(socket);
      this.options.log('info', 'websocket_backpressure_recovered', {
        socketId: this.socketIds.get(socket) ?? null,
        durationMilliseconds: now - backpressureAt,
      });
    }
    const payload = JSON.stringify(message);
    const bufferedBefore = socket.bufferedAmount;
    socket.send(payload, (error) => {
      if (error) this.options.log('warn', 'websocket_send_error', {
        socketId: this.socketIds.get(socket) ?? null,
        messageType: message.type, message: error.message, bufferedAmount: socket.bufferedAmount,
      });
    });
    if (message.type === 'hello' || message.type === 'baseline') {
      this.options.log('info', 'websocket_handshake_sent', {
        socketId: this.socketIds.get(socket) ?? null, messageType: message.type,
        payloadBytes: Buffer.byteLength(payload), bufferedBefore, bufferedAfter: socket.bufferedAmount,
      });
    }
    return true;
  }

  private handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const socketId = this.nextSocketId++;
    this.socketIds.set(socket, socketId);
    const openedAt = performance.now();
    let receivedMessages = 0;
    let receivedBytes = 0;
    let pingCount = 0;
    let diagnosticWindowStarted = Date.now();
    let diagnosticCount = 0;
    let connection: GameplayConnection | null = null;
    this.options.log('info', 'socket_opened', {
      socketId,
      remoteAddress: request?.socket.remoteAddress ?? null,
      userAgent: request?.headers['user-agent'] ?? null,
      origin: request?.headers.origin ?? null,
    });
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
      receivedMessages++;
      receivedBytes += Array.isArray(data)
        ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
        : data.byteLength;
      try {
        const raw: unknown = JSON.parse(data.toString());
        const requestedType = requestedMessageType(raw);
        if (!connection && requestedType && DEBUG_MESSAGE_TYPES.has(requestedType)) {
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
          const debugEnabled = this.options.debugControlsEnabled;
          const revision = this.options.revision();
          const projection = this.options.runtime.projection(
            claims.countryId, this.options.devSimSpeed.get(), debugEnabled,
          );
          connection = {
            socket, accountId: claims.accountId, countryId: claims.countryId, debugEnabled,
            projection, revision,
          };
          this.connections.add(connection);
          this.sendSocket(socket, {
            type: 'hello', gameId: GAME_ID, gameVersion: GAME_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            capabilities: [
              'filtered-baseline', 'change-only-deltas', 'resync',
              'pending-commands', 'authoritative-timeline',
              ...(this.options.clientLog ? ['client-diagnostics'] : []),
            ],
            world: this.options.world,
            countryId: claims.countryId,
            debugEnabled,
          });
          this.sendSocket(socket, {
            type: 'baseline', revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          this.sendDebugState(connection);
          this.options.log('info', 'client_connected', {
            socketId, accountId: claims.accountId, countryId: claims.countryId,
            revision, baselineArmies: Object.keys(projection.armies).length,
            authenticationMilliseconds: performance.now() - openedAt,
          });
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
          pingCount++;
          this.sendSocket(socket, { type: 'pong', sentAt: message.sentAt, serverEpochMs: Date.now() }); return;
        }
        if (message.type === 'clientDiagnostic') {
          const now = Date.now();
          if (now - diagnosticWindowStarted >= 60_000) {
            diagnosticWindowStarted = now;
            diagnosticCount = 0;
          }
          if (++diagnosticCount <= 120) {
            this.options.clientLog?.(message.level, message.event, {
              ...(message.fields ?? {}),
              socketId, accountId: connection.accountId, countryId: connection.countryId,
              clientEpochMs: message.clientEpochMs,
              serverReceivedEpochMs: now,
            });
          }
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
          this.options.log('warn', 'client_resync_requested', {
            socketId, accountId: connection.accountId, countryId: connection.countryId,
            clientRevision: message.afterRevision ?? null, serverRevision: this.options.revision(),
            bufferedAmount: socket.bufferedAmount,
          });
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
        const commandStarted = performance.now();
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
        this.options.log(result.ok ? 'info' : 'warn', 'command_processed', {
          socketId, accountId: connection.accountId, countryId: connection.countryId,
          commandId: message.commandId, commandType: message.command.type, ok: result.ok,
          reason: result.reason ?? null, revision: connection.revision,
          milliseconds: performance.now() - commandStarted,
        });
      } catch (error) {
        this.options.log('warn', 'invalid_client_message', {
          socketId,
          accountId: connection?.accountId ?? null,
          countryId: connection?.countryId ?? null,
          message: error instanceof Error ? error.message : String(error),
          receivedMessages,
        });
        this.sendSocket(socket, {
          type: 'error', code: 'invalid_message',
          message: error instanceof Error ? error.message : 'Invalid message.',
        });
      }
    });
    socket.on('error', (error) => this.options.log('warn', 'socket_error', {
      socketId, accountId: connection?.accountId ?? null, countryId: connection?.countryId ?? null,
      message: error.message, bufferedAmount: socket.bufferedAmount,
    }));
    socket.on('close', (code, reason) => {
      clearTimeout(authenticationTimeout);
      if (connection) {
        this.connections.delete(connection);
        this.options.log('info', 'client_disconnected', {
          accountId: connection.accountId,
          countryId: connection.countryId,
          socketId,
          code,
          reason: reason.toString(),
          bufferedAmount: socket.bufferedAmount,
          connectedMilliseconds: performance.now() - openedAt,
          receivedMessages,
          receivedBytes,
          pingCount,
        });
      } else {
        this.options.log('warn', 'unauthenticated_socket_closed', {
          socketId, code, reason: reason.toString(), bufferedAmount: socket.bufferedAmount,
          connectedMilliseconds: performance.now() - openedAt, receivedMessages, receivedBytes,
        });
      }
    });
  }
}
