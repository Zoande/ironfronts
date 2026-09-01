import {
  PROTOCOL_VERSION, serverMessageSchema, type CommandPayload, type PlayerProjection,
  type PresentationCatalogs, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { connectGame } from './auth-api';
import { applyDelta } from './replica-store';
import { InterpolatedGameClock, type GameClockReading } from './game-clock';

interface PendingCommand {
  timer: number;
  settle: (ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void;
}

export class GameConnection extends EventTarget {
  state!: PlayerProjection;
  catalogs!: PresentationCatalogs;
  world!: WorldDescriptor;
  revision = 0;
  /** Current server-wide sim-speed multiplier and whether the dev control is
   *  even usable (always false against a production server). */
  devSimSpeed = 1;
  devSimSpeedEnabled = false;
  private readonly gameClock = new InterpolatedGameClock();
  private socket: WebSocket | null = null;
  private closed = false;
  private commandSequence = 0;
  private readonly pending = new Map<string, PendingCommand>();

  static async open(onStage?: (stage: string) => void): Promise<GameConnection> {
    const connection = new GameConnection();
    await connection.connect(onStage);
    return connection;
  }

  private async connect(onStage?: (stage: string) => void): Promise<void> {
    onStage?.('Contacting command server');
    const descriptor = await connectGame();
    if (descriptor.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error('The game uses an unsupported protocol version.');
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(descriptor.websocketUrl);
      this.socket = socket;
      let ready = false;
      let settled = false;

      const settleError = (error: Error, closeCode?: number, closeReason?: string): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          try { socket.close(closeCode ?? 1000, closeReason ?? 'Connection failed'); } catch { /* ignore close races */ }
        }
      };

      const settleReady = (): void => {
        if (settled) return;
        settled = true;
        ready = true;
        window.clearTimeout(timeout);
        resolve();
      };

      const timeout = window.setTimeout(() => {
        settleError(new Error('Game connection timed out.'), 4000, 'Connection timeout');
      }, 10_000);

      socket.addEventListener('open', () => {
        onStage?.('Authenticating operation');
        socket.send(JSON.stringify({
          type: 'authenticate', protocolVersion: PROTOCOL_VERSION, ticket: descriptor.ticket,
        }));
      });

      socket.addEventListener('message', (event) => {
        let message: ServerMessage;
        try {
          message = serverMessageSchema.parse(JSON.parse(String(event.data)));
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (!ready) {
            settleError(new Error(`Invalid response from game server: ${detail}`), 1002, 'Invalid server message');
          } else {
            console.error('[game-connection] invalid server message', error);
            this.dispatchEvent(new CustomEvent('connection-error', { detail: 'Invalid response from game server.' }));
          }
          return;
        }

        if (message.type === 'hello') {
          if (message.protocolVersion !== PROTOCOL_VERSION) {
            settleError(new Error('Protocol mismatch.'), 1002, 'Protocol mismatch');
            return;
          }
          onStage?.('Receiving battlefield state');
          this.world = message.world;
        } else if (message.type === 'baseline') {
          this.state = message.state;
          this.catalogs = message.catalogs;
          this.revision = message.revision;
          this.gameClock.synchronize(message.clock);
          this.dispatchEvent(new Event('state'));
          if (!ready) settleReady();
        } else if (message.type === 'delta') {
          if (message.fromRevision !== this.revision) {
            socket.send(JSON.stringify({ type: 'resync', afterRevision: this.revision }));
            return;
          }
          this.state = applyDelta(this.state, message.delta);
          this.revision = message.revision;
          this.dispatchEvent(new Event('state'));
          for (const filteredEvent of message.events) {
            this.dispatchEvent(new CustomEvent('game-event', { detail: filteredEvent }));
          }
        } else if (message.type === 'commandAck') {
          const pending = this.pending.get(message.commandId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.commandId);
            pending.settle(message.ok, message.reason, message.requiredWarCountryIds);
          }
        } else if (message.type === 'clockSync') {
          this.gameClock.synchronize(message.clock);
          this.dispatchEvent(new Event('clock-sync'));
        } else if (message.type === 'devSimSpeed') {
          this.devSimSpeed = message.multiplier;
          this.devSimSpeedEnabled = message.devControlsEnabled;
          this.dispatchEvent(new Event('dev-sim-speed'));
        } else if (message.type === 'error') {
          if (!ready) {
            settleError(new Error(message.message), 1008, 'Server rejected connection');
            return;
          }
          this.dispatchEvent(new CustomEvent('connection-error', { detail: message.message }));
        }
      });

      socket.addEventListener('error', () => {
        if (!ready) settleError(new Error('Unable to connect to game server.'));
      });

      socket.addEventListener('close', () => {
        window.clearTimeout(timeout);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.settle(false, 'Connection lost.');
        }
        this.pending.clear();

        if (!ready) {
          settleError(new Error('Game connection closed before the battlefield state arrived.'));
          return;
        }
        if (!this.closed) window.setTimeout(() => void this.reconnect(), 1_000);
      });
    });
  }

  private async reconnect(): Promise<void> {
    try { await this.connect(); }
    catch { if (!this.closed) window.setTimeout(() => void this.reconnect(), 2_500); }
  }

  command(
    command: CommandPayload,
    onResult: (ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void,
  ): string {
    const commandId = `${Date.now().toString(36)}-${(++this.commandSequence).toString(36)}`;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      queueMicrotask(() => onResult(false, 'Connection unavailable.'));
      return commandId;
    }
    const timer = window.setTimeout(() => {
      this.pending.delete(commandId);
      onResult(false, 'Command timed out.');
    }, 5_000);
    this.pending.set(commandId, { timer, settle: onResult });
    this.socket.send(JSON.stringify({ type: 'command', commandId, command }));
    return commandId;
  }

  readClock(): GameClockReading { return this.gameClock.read(); }

  /** Dev/test only — server ignores this against a production server. */
  setDevSimSpeed(multiplier: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'devSetSimSpeed', multiplier }));
  }

  close(): void { this.closed = true; this.socket?.close(1000, 'Client closed'); }
}
