import { Effect, Layer, ManagedRuntime } from 'effect';
import { InboxRepositoryService } from '../engine/db.ts';
import {
    inboxEngineLive,
    type InboxEngine,
    type InboxEngineEffects,
} from '../engine/inbox.ts';
import { InboxProviderService } from '../provider/inbox.ts';

/** Host commands must enter through the owning ManagedRuntime. */
export function bindInboxEngine(
    engine: InboxEngineEffects,
    runPromise: <A>(effect: Effect.Effect<A>) => Promise<A>,
): InboxEngine {
    return {
        ...engine,
        refresh: () => runPromise(engine.refresh),
        loadMoreInbox: () => runPromise(engine.loadMoreInbox),
        refreshHistory: (id, listener, anchorId) =>
            runPromise(engine.refreshHistory(id, listener, anchorId)),
        loadOlderHistory: (id, listener) =>
            runPromise(engine.loadOlderHistory(id, listener)),
        loadNewerHistory: (id, listener) =>
            runPromise(engine.loadNewerHistory(id, listener)),
    };
}

export function makeWorkerLayer(
    provider: Layer.Layer<InboxProviderService>,
    repository: Layer.Layer<InboxRepositoryService>,
) {
    return inboxEngineLive.pipe(
        Layer.provideMerge(provider),
        Layer.provideMerge(repository),
    );
}

export function makeWorkerRuntime(
    provider: Layer.Layer<InboxProviderService>,
    repository: Layer.Layer<InboxRepositoryService>,
) {
    return ManagedRuntime.make(makeWorkerLayer(provider, repository));
}
