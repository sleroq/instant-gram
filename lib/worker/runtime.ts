import { Effect } from 'effect';
import browser from 'webextension-polyfill';
import { inboxRepositoryLive } from '../engine/db.ts';
import {
    InboxEngineService,
    type InboxEngine,
    type InboxEngineEffects,
} from '../engine/inbox.ts';
import { ensureAnchorTab } from '../provider/anchor.ts';
import {
    InboxProviderService,
    inboxProviderLive,
    type ProviderPort,
} from '../provider/inbox.ts';
import { makeWorkerRuntime } from './layer.ts';

const ProviderLive = inboxProviderLive({
    ensureAnchor: ensureAnchorTab,
    extensionId: browser.runtime.id,
});
const RepositoryLive = inboxRepositoryLive();

/** The single Effect runtime owned by the extension service worker. */
export const workerRuntime = makeWorkerRuntime(ProviderLive, RepositoryLive);

export function runWorker<A>(
    effect: Effect.Effect<A, never, InboxProviderService | InboxEngineService>,
): void {
    workerRuntime.runFork(effect);
}

export function withEngine<A>(
    use: (engine: InboxEngine) => A,
): Effect.Effect<A, never, InboxEngineService> {
    return Effect.gen(function* () {
        const engine = yield* InboxEngineService;
        const context = yield* Effect.context<never>();
        return use(promiseBoundary(engine, Effect.runPromiseWith(context)));
    });
}

function promiseBoundary(
    engine: InboxEngineEffects,
    runPromise: <A>(effect: Effect.Effect<A>) => Promise<A>,
): InboxEngine {
    return {
        ...engine,
        refresh: () => runPromise(engine.refresh),
        loadMoreInbox: () => runPromise(engine.loadMoreInbox),
        refreshHistory: (id) => runPromise(engine.refreshHistory(id)),
        loadOlderHistory: (id) => runPromise(engine.loadOlderHistory(id)),
    };
}

export function acceptProvider(
    port: ProviderPort,
): Effect.Effect<void, never, InboxProviderService> {
    return Effect.map(InboxProviderService, (provider) =>
        provider.accept(port),
    );
}
