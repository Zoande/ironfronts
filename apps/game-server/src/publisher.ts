import type { PlayerProjection, ServerMessage } from '@ironfronts/protocol';
import type { GameRuntime } from './runtime';
import type { GameplayConnection } from './gameplay-gateway';
import { diffProjection } from './projection';
import { collectPendingEvents, eventsForCountry } from './event-feed';

/** Connections advance only after an actual delivery; events can create an
 * otherwise empty delta. Baselines reconcile state after missed events. */
export class ProjectionPublisher {
  revision = 0;
  private readonly eventBacklog = new Map<number, import('@ironfronts/protocol').FilteredEvent[]>();
  constructor(private readonly runtime: GameRuntime,
    private readonly connections: () => Iterable<GameplayConnection>,
    private readonly send: (connection: GameplayConnection, message: ServerMessage) => boolean,
    private readonly speed: () => number) {}

  publish(): void {
    const batch = collectPendingEvents(this.runtime, this.revision);
    // eventsForCountry is a no-op for every country when the batch is empty
    // (the common case, most ticks) — skip the ~200-country scan entirely.
    if (batch.countryEvents.length || batch.combatEvents.length || batch.publicEvents.length) {
      for (const country of Object.values(this.runtime.session.state.countries)) {
        const additions = eventsForCountry(batch, country.id, this.revision + 1);
        if (!additions.length) continue;
        const backlog = [...(this.eventBacklog.get(country.id) ?? []), ...additions];
        this.eventBacklog.set(country.id, backlog.slice(-512));
      }
    }
    const connections = [...this.connections()];
    const projections = new Map<string, PlayerProjection>();
    const revision = this.revision + 1;
    let delivered = false;
    const eventDelivery = new Map<number, { attempted: number; succeeded: number }>();
    for (const connection of connections) {
      const projectionKey = `${connection.countryId}:${connection.debugEnabled ? 'debug' : 'player'}`;
      let next = projections.get(projectionKey);
      if (!next) {
        next = this.runtime.projection(connection.countryId, this.speed(), connection.debugEnabled);
        projections.set(projectionKey, next);
      }
      const delta = diffProjection(connection.projection, next);
      const events = this.eventBacklog.get(connection.countryId) ?? [];
      if (!delta && !events.length) continue;
      const sent = this.send(connection, { type: 'delta', fromRevision: connection.revision, revision,
        delta: delta ?? { changed: {}, upserts: {}, removals: {}, redactions: [] }, events });
      if (events.length) {
        const status = eventDelivery.get(connection.countryId) ?? { attempted: 0, succeeded: 0 };
        status.attempted += 1; status.succeeded += sent ? 1 : 0;
        eventDelivery.set(connection.countryId, status);
      }
      if (!sent) continue;
      connection.projection = next;
      connection.revision = revision;
      delivered = true;
    }
    for (const [countryId, status] of eventDelivery) {
      const recipientCount = connections.filter((connection) => connection.countryId === countryId).length;
      if (status.attempted === recipientCount && status.succeeded === recipientCount) this.eventBacklog.delete(countryId);
    }
    if (delivered) this.revision = revision;
  }
}
