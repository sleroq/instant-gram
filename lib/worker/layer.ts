import { Layer, ManagedRuntime } from 'effect';
import { InboxRepositoryService } from '../engine/db.ts';
import { inboxEngineLive } from '../engine/inbox.ts';
import { InboxProviderService } from '../provider/inbox.ts';

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
