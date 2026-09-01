/** Gameplay WebSocket transport: upgrades, authentication, commands, and connections. */

import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION, clientMessageSchema,
  type PlayerProjection, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { verifyGameTicket } from '@ironfronts/protocol/ticket';
import type { GameRuntime } from './runtime';
import type { AuthoritativeGameClock } from './game-clock';
import { TicketNonceStore } from './ticket-nonces';

export interface GameplayConnection {
  readonly socket: WebSocket;
  readonly accountId: string;
  readonly countryId: number;
  projection: PlayerProjection;
  revision: number;
}

export interface GameplayGatewayOptions {
  readonly server: HttpServer;
  readonly runtime: GameRuntime;
  readonly clientOrigin: string;
  readonly ticketSecret: string;
  readonly world: WorldDescriptor;
  readonly clock: AuthoritativeGameClock;
  readonly revision: () => number;
  readonly saveGameInBackground: () => void;
  readonly devSimSpeed: { get(): number; set(multiplier: number): void; enabled: boolean };
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

  send(connection: GameplayConnection, message: ServerMessage): void {
    this.sendSocket(connection.socket, message);
  }

  broadcast(message: ServerMessage): void {
    for (const connection of this.connections) this.send(connection, message);
  }

  closeAll(code = 1001, reason = 'Server shutting down'): void {
    for (const connection of this.connections) connection.socket.close(code, reason);
  }

  private sendSocket(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
        const message = clientMessageSchema.parse(JSON.parse(data.toString()));
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
          const revision = this.options.revision();
          const projection = this.options.runtime.projection(claims.countryId);
          connection = {
            socket, accountId: claims.accountId, countryId: claims.countryId, projection, revision,
          };
          this.connections.add(connection);
          this.sendSocket(socket, {
            type: 'hello', gameId: GAME_ID, gameVersion: GAME_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            capabilities: [
              'filtered-baseline', 'change-only-deltas', 'resync',
              'optimistic-commands', 'sparse-clock-sync',
            ],
            world: this.options.world,
            countryId: claims.countryId,
          });
          this.sendSocket(socket, {
            type: 'baseline', revision, state: projection,
            catalogs: this.options.runtime.catalogs, clock: this.options.clock.snapshot(),
          });
          this.sendSocket(socket, {
            type: 'devSimSpeed', multiplier: this.options.devSimSpeed.get(),
            devControlsEnabled: this.options.devSimSpeed.enabled,
          });
          this.options.log('info', 'client_connected', { countryId: claims.countryId });
          return;
        }
        if (!connection) throw new Error('Authentication required.');
        if (message.type === 'devSetSimSpeed') {
          this.options.devSimSpeed.set(message.multiplier);
          this.broadcast({
            type: 'devSimSpeed', multiplier: this.options.devSimSpeed.get(),
            devControlsEnabled: this.options.devSimSpeed.enabled,
          });
          return;
        }
        if (message.type === 'resync') {
          const projection = this.options.runtime.projection(connection.countryId);
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
        if (result.ok) this.options.saveGameInBackground();
        const acknowledgement: ServerMessage = {
          type: 'commandAck', commandId: message.commandId, ok: result.ok,
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
    socket.on('close', () => {
      clearTimeout(authenticationTimeout);
      if (connection) this.connections.delete(connection);
    });
  }
}
