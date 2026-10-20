import { Effect, Layer, Result } from 'effect';
import {
    InboxRepositoryService,
    adaptInboxRepository,
} from '../lib/engine/db.ts';
import {
    InboxEngineService,
    InboxError,
    type InboxRepository,
} from '../lib/engine/inbox.ts';
import {
    InboxProviderService,
    type InboxProviderEffects,
} from '../lib/provider/inbox.ts';
import { bindInboxEngine, makeWorkerRuntime } from '../lib/worker/layer.ts';
import type { Page, Thread, ThreadMessages } from '../lib/domain.ts';

type TestProvider = {
    account(): Promise<string>;
    inbox(expectedAccountId: string, cursor?: string): Promise<Page<Thread>>;
    history(
        expectedAccountId: string,
        threadKey: string,
        cursor?: string,
    ): Promise<ThreadMessages>;
};

export async function createInboxEngine(
    repository: InboxRepository,
    provider: TestProvider,
) {
    const providerEffects: InboxProviderEffects = {
        accept: () => undefined,
        account: Effect.tryPromise({
            try: () => provider.account(),
            catch: (cause) =>
                cause instanceof InboxError
                    ? cause
                    : new InboxError('provider_unavailable'),
        }),
        inbox: (accountId, cursor) =>
            Effect.tryPromise({
                try: () => provider.inbox(accountId, cursor),
                catch: (cause) =>
                    cause instanceof InboxError
                        ? cause
                        : new InboxError('protocol'),
            }),
        history: (accountId, threadId, cursor) =>
            Effect.tryPromise({
                try: () => provider.history(accountId, threadId, cursor),
                catch: (cause) =>
                    cause instanceof InboxError
                        ? cause
                        : new InboxError('protocol'),
            }),
    };

    const runtime = makeWorkerRuntime(
        Layer.succeed(InboxProviderService, providerEffects),
        Layer.succeed(InboxRepositoryService, adaptInboxRepository(repository)),
    );
    const engine = await runtime.runPromise(InboxEngineService);
    return {
        ...bindInboxEngine(engine, async (command) => {
            const result = await runtime.runPromise(Effect.result(command));
            if (Result.isFailure(result)) throw result.failure;
            return result.success;
        }),
        dispose: () => runtime.dispose(),
    };
}
