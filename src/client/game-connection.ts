import {
  PROTOCOL_VERSION, serverMessageSchema, type ClientMessage, type CommandPayload, type FilteredEvent,
  type PlayerProjection, type PresentationCatalogs, type ServerMessage, type WorldDescriptor,
} from '@ironfronts/protocol';
import { connectGame } from './auth-api';
import { applyDelta } from './replica-store';
import { InterpolatedGameClock, type GameClockReading } from './game-clock';

type ResultCallback = (ok: boolean, reason?: string, wars?: readonly number[], appliedRevision?: number) => void;
interface PendingCommand { timer: number; settle: ResultCallback }
export type ConnectionStatus = 'connecting' | 'ready' | 'resyncing' | 'disconnected' | 'closed' | 'incompatible';
const CONNECTION_STALE_MS = 5_000;

export class GameConnection extends EventTarget {
  state!: PlayerProjection;
  catalogs!: PresentationCatalogs;
  world!: WorldDescriptor;
  revision = 0;
  baselineGeneration = 0;
  status: ConnectionStatus = 'connecting';
  /** Granted by the authenticated server handshake for this connection. */
  debugEnabled = false;
  devSimSpeed = 1;
  devSimSpeedEnabled = false;
  devDiagnostics = {
    requestedSpeed: 1, effectiveSpeed: 1, pendingSimulationSeconds: 0,
    lastPumpSteps: 0, lastPumpMilliseconds: 0, overloaded: false,
  };
  lastDevCheatResult?: { action: 'build' | 'spawn' | 'resource'; ok: boolean; message: string };
  private readonly gameClock = new InterpolatedGameClock();
  private socket: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private retryTimer?: number;
  private resyncTimer?: number;
  private heartbeat?: number;
  private cancelConnect?: () => void;
  private lastMessageMs = 0;
  private serverEpochMs = 0;
  private serverSampleAt = 0;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly seenEvents = new Set<string>();

  static async open(onStage?: (stage: string) => void): Promise<GameConnection> {
    const connection = new GameConnection();
    try { await connection.connect(onStage); return connection; }
    catch (error) { connection.close(); throw error; }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    if (status !== 'ready') this.gameClock.freeze();
    this.dispatchEvent(new Event('connection-status'));
  }

  get fresh(): boolean {
    return this.status === 'ready' && this.socket?.readyState === WebSocket.OPEN
      && performance.now() - this.lastMessageMs < CONNECTION_STALE_MS;
  }
  serverNow(): number { return this.serverEpochMs + Math.max(0, performance.now() - this.serverSampleAt); }

  private async connect(onStage?: (stage: string) => void): Promise<void> {
    if (this.closed) return;
    const attempt = ++this.attempt;
    if (this.debugEnabled) {
      this.debugEnabled = false;
      this.dispatchEvent(new Event('debug-access'));
    }
    this.setStatus('connecting');
    onStage?.('Contacting command server');
    const descriptor = await connectGame();
    if (this.closed || attempt !== this.attempt) return;
    if (descriptor.protocolVersion !== PROTOCOL_VERSION) throw new Error('Unsupported game protocol. Reload the client.');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(descriptor.websocketUrl);
      this.socket = socket;
      let ready = false;
      let settled = false;
      let hello = false;
      const current = (): boolean => !this.closed && attempt === this.attempt;
      const settleError = (error: Error, code = 1000, reason = 'Connection failed'): void => {
        if (!settled) { settled = true; window.clearTimeout(timeout); reject(error); }
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
          try { socket.close(code, reason); } catch { /* Connecting socket may already be closed. */ }
        }
      };
      const timeout = window.setTimeout(() => settleError(new Error('Game connection timed out.'), 4000, 'Connection timeout'), 10_000);
      this.cancelConnect = () => settleError(new Error('Connection cancelled.'));
      socket.addEventListener('open', () => {
        if (!current()) { socket.close(); return; }
        onStage?.('Authenticating operation');
        socket.send(JSON.stringify({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION, ticket: descriptor.ticket }));
      });
      socket.addEventListener('message', (event) => {
        if (!current()) return;
        let message: ServerMessage;
        try { message = serverMessageSchema.parse(JSON.parse(String(event.data))); }
        catch { settleError(new Error('Invalid response from game server.'), 1002, 'Invalid server message'); return; }
        this.lastMessageMs = performance.now();
        if (message.type === 'hello') {
          hello = true;
          this.debugEnabled = message.debugEnabled;
          this.dispatchEvent(new Event('debug-access'));
          if (this.world && this.world.hash !== message.world.hash) {
            this.setStatus('incompatible'); this.closed = true;
            this.dispatchEvent(new CustomEvent('connection-error', { detail: 'The world changed. Return to command and rejoin.' }));
            settleError(new Error('World changed.'), 1008, 'World changed'); return;
          }
          this.world = message.world;
          onStage?.('Receiving battlefield state');
        } else if (message.type === 'baseline') {
          if (!hello) { settleError(new Error('Baseline arrived before handshake.'), 1002); return; }
          this.state = message.state; this.catalogs = message.catalogs; this.revision = message.revision;
          this.baselineGeneration++;
          window.clearTimeout(this.resyncTimer);
          this.serverEpochMs = message.clock.serverEpochMs; this.serverSampleAt = performance.now();
          this.gameClock.synchronize(message.clock);
          this.setStatus('ready');
          this.dispatchEvent(new CustomEvent('state', { detail: { baseline: true } }));
          if (!ready) {
            ready = true; settled = true; window.clearTimeout(timeout); this.cancelConnect = undefined;
            this.startHeartbeat(); resolve();
          }
        } else if (message.type === 'delta') {
          if (!ready) { settleError(new Error('Delta arrived before baseline.'), 1002); return; }
          if (this.status === 'resyncing') return;
          if (message.fromRevision !== this.revision || message.revision <= this.revision) { this.resync(); return; }
          this.state = applyDelta(this.state, message.delta); this.revision = message.revision;
          this.dispatchEvent(new CustomEvent('state', { detail: { baseline: false } }));
          for (const entry of message.events) this.emitEvent(entry);
        } else if (message.type === 'commandAck') {
          const pending = this.pending.get(message.commandId);
          if (pending) {
            window.clearTimeout(pending.timer); this.pending.delete(message.commandId);
            pending.settle(message.ok, message.reason, message.requiredWarCountryIds, message.appliedRevision);
          }
        } else if (message.type === 'event') this.emitEvent(message.event);
        else if (message.type === 'clockSync') {
          if (this.status === 'ready') this.gameClock.synchronize(message.clock);
          this.dispatchEvent(new Event('clock-sync'));
        } else if (message.type === 'pong') {
          const now = performance.now();
          this.serverEpochMs = message.serverEpochMs + Math.max(0, now - message.sentAt) / 2;
          this.serverSampleAt = now;
        } else if (message.type === 'devSimSpeed') {
          this.devSimSpeed = message.multiplier;
          this.devSimSpeedEnabled = message.devControlsEnabled;
          this.dispatchEvent(new Event('dev-sim-speed'));
        } else if (message.type === 'devDiagnostics') {
          this.devDiagnostics = message;
          this.dispatchEvent(new Event('dev-diagnostics'));
        } else if (message.type === 'devCheatResult') {
          this.lastDevCheatResult = message;
          this.dispatchEvent(new CustomEvent('dev-cheat-result', { detail: message }));
        } else if (message.type === 'error') {
          if (!ready) settleError(new Error(message.message), 1008, 'Server rejected connection');
          else this.dispatchEvent(new CustomEvent('connection-error', { detail: message.message }));
        }
      });
      socket.addEventListener('error', () => {
        if (!ready) settleError(new Error('Unable to connect to game server.'));
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(timeout); window.clearTimeout(this.resyncTimer);
        if (attempt !== this.attempt) return;
        window.clearInterval(this.heartbeat); this.heartbeat = undefined;
        this.failPending('Connection lost; command outcome may be unknown.');
        if (!ready) { settleError(new Error('Game connection closed before the battlefield state arrived.')); return; }
        if (!this.closed) { this.setStatus('disconnected'); this.scheduleReconnect(1_000); }
      });
    });
  }

  private startHeartbeat(): void {
    window.clearInterval(this.heartbeat);
    this.send({ type: 'ping', sentAt: performance.now() });
    this.heartbeat = window.setInterval(() => {
      if (performance.now() - this.lastMessageMs > CONNECTION_STALE_MS) {
        this.socket?.close(4000, 'Connection stale'); return;
      }
      this.send({ type: 'ping', sentAt: performance.now() });
    }, 1_000);
  }
  private scheduleReconnect(delay: number): void {
    window.clearTimeout(this.retryTimer);
    if (this.closed) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.closed) void this.connect().catch(() => { if (!this.closed) { this.setStatus('disconnected'); this.scheduleReconnect(2_500); } });
    }, delay);
  }
  private emitEvent(event: FilteredEvent): void {
    if (this.seenEvents.has(event.id)) return;
    this.seenEvents.add(event.id);
    if (this.seenEvents.size > 2_048) this.seenEvents.delete(this.seenEvents.values().next().value!);
    this.dispatchEvent(new CustomEvent('game-event', { detail: event }));
  }
  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private resync(): void {
    if (this.status === 'resyncing') return;
    this.setStatus('resyncing'); this.send({ type: 'resync', afterRevision: this.revision });
    this.resyncTimer = window.setTimeout(() => this.socket?.close(4000, 'Resync timeout'), 5_000);
  }
  command(command: CommandPayload, onResult: ResultCallback): string {
    const commandId = crypto.randomUUID();
    // The heartbeat owns stale-link detection. A shorter command threshold
    // rejected healthy sockets during brief server-load or scheduling lulls.
    if (this.status !== 'ready' || this.socket?.readyState !== WebSocket.OPEN) {
      queueMicrotask(() => onResult(false, 'Connection unavailable.')); return commandId;
    }
    const timer = window.setTimeout(() => {
      this.pending.delete(commandId); this.resync();
      onResult(false, 'Command outcome unknown; synchronizing with the server.');
    }, 5_000);
    this.pending.set(commandId, { timer, settle: onResult });
    this.send({ type: 'command', commandId, command }); return commandId;
  }
  readEpochMs(): number { return this.gameClock.readEpochMs(); }
  readClock(): GameClockReading { return this.gameClock.read(); }
  setDevSimSpeed(multiplier: number): void { this.send({ type: 'devSetSimSpeed', multiplier }); }
  setDevClock(epochMs: number): void { this.send({ type: 'devSetClock', epochMs }); }
  linkDevClockToTimezone(timeZone: string): void {
    this.send({ type: 'devLinkClockTimezone', timeZone });
  }
  setDevWeather(mode: 'automatic' | 'forced-clear' | 'forced-rain'): void {
    this.send({ type: 'devSetWeather', mode });
  }
  devCheatBuild(provinceId: number, buildingId: 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump', level: number): void {
    this.send({ type: 'devCheatBuild', provinceId, buildingId, level });
  }
  devCheatSpawnUnit(provinceId: number, countryId: number, unitTypeId: string): void {
    this.send({ type: 'devCheatSpawnUnit', provinceId, countryId, unitTypeId });
  }
  devCheatGiveResource(countryId: number, resource: 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil', amount: number): void {
    this.send({ type: 'devCheatGiveResource', countryId, resource, amount });
  }
  private failPending(reason: string): void {
    for (const entry of this.pending.values()) { window.clearTimeout(entry.timer); entry.settle(false, reason); }
    this.pending.clear();
  }
  close(): void {
    if (this.closed && this.status === 'closed') return;
    this.closed = true; this.attempt++;
    window.clearTimeout(this.retryTimer); window.clearTimeout(this.resyncTimer); window.clearInterval(this.heartbeat);
    this.cancelConnect?.(); this.cancelConnect = undefined;
    this.failPending('Connection closed.'); this.setStatus('closed');
    this.socket?.close(1000, 'Client closed'); this.socket = null;
  }
}
