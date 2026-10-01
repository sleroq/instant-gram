import { Effect, Exit } from 'effect';
import browser from 'webextension-polyfill';
import { inboxRepositoryLive } from '../engine/db.ts';
import { InboxEngineService, type InboxEngine } from '../engine/inbox.ts';
import { ensureAnchorTab } from '../provider/anchor.ts';
import { InboxProviderService, inboxProviderLive } from '../provider/inbox.ts';
import { bindInboxEngine, makeWorkerRuntime } from './layer.ts';

const ProviderLive = inboxProviderLive({
    ensureAnchor: ensureAnchorTab,
    extensionId: browser.runtime.id,
});
const RepositoryLive = inboxRepositoryLive();

/** The single Effect runtime owned by the extension service worker. */
export const workerRuntime = makeWorkerRuntime(ProviderLive, RepositoryLive);

export function runWorker<A>(
    effect: Effect.Effect<A, never, InboxProviderService | InboxEngineService>,
    onFailure?: () => void,
): void {
    const fiber = workerRuntime.runFork(
        effect.pipe(Effect.tapDefect(Effect.logError)),
    );
    if (onFailure)
        fiber.addObserver((exit) => {
            if (Exit.isFailure(exit)) onFailure();
        });
}

export function withEngine<A>(
    use: (engine: InboxEngine) => A,
): Effect.Effect<A, never, InboxEngineService> {
    return Effect.gen(function* () {
        const engine = yield* InboxEngineService;
        return use(
            bindInboxEngine(engine, (command) =>
                workerRuntime.runPromise(
                    command.pipe(Effect.tapDefect(Effect.logError)),
                ),
            ),
        );
    });
}

export function acceptProvider(
    activate: (provider: InboxProviderService['Service']) => void,
): Effect.Effect<void, never, InboxProviderService> {
    return Effect.map(InboxProviderService, (provider) => activate(provider));
}
