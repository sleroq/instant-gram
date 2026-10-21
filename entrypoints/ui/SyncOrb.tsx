import {
    createEffect,
    createMemo,
    createSignal,
    createUniqueId,
    For,
    Show,
} from 'solid-js';
import type {
    HistoryProjection,
    ResourceProjection,
} from '../../lib/engine/inbox';

const priority = {
    failed: 0,
    unavailable: 1,
    loading: 2,
    refreshing: 3,
    retained: 4,
    fresh: 5,
};
type SyncState = { kind: keyof typeof priority; label: string; detail: string };

function describeResource(
    resource: ResourceProjection | undefined,
    history = false,
    newerCoverageAvailable = false,
): SyncState {
    if (resource?.error || resource?.synchronization === 'error')
        return {
            kind: 'failed',
            label: 'Sync failed',
            detail:
                resource?.availability === 'present'
                    ? 'Loaded content remains available. See the error and recovery controls in Chats.'
                    : 'Content is unavailable. See the error and recovery controls in Chats.',
        };

    if (
        !resource ||
        (resource.availability === 'absent' &&
            resource.synchronization === 'refreshing')
    )
        return {
            kind: 'loading',
            label: 'Loading',
            detail: 'Waiting for initial content. The worker request may be queued or in progress.',
        };

    if (resource.availability === 'absent')
        return {
            kind: 'unavailable',
            label: 'Unavailable',
            detail: 'No content is currently available.',
        };

    if (resource.synchronization === 'refreshing')
        return {
            kind: 'refreshing',
            label: 'Refreshing',
            detail: 'Loaded content remains available while the worker checks for updates. The request may be queued or in progress.',
        };

    if (resource.freshness === 'stale' || newerCoverageAvailable)
        return {
            kind: 'retained',
            label: 'Retained content',
            detail: history
                ? 'Showing retained history. It does not establish current or complete coverage. Newer messages may be available.'
                : 'Showing cached conversations. Updates have not been confirmed.',
        };

    return {
        kind: 'fresh',
        label: 'Fresh',
        detail: history
            ? 'Loaded history is fresh. More messages may exist outside this window.'
            : 'Loaded conversations are up to date.',
    };
}

/** One presentation of the existing inbox and selected-history resources. */
export function SyncOrb(props: {
    inbox: ResourceProjection;
    selectedThreadId?: string;
    history?: HistoryProjection;
}) {
    const descriptionId = createUniqueId();
    const [open, setOpen] = createSignal(false);
    createEffect(open, (visible) => {
        if (!visible) return;
        function dismiss(event: KeyboardEvent) {
            if (event.key === 'Escape') setOpen(false);
        }
        document.addEventListener('keydown', dismiss);
        return () => document.removeEventListener('keydown', dismiss);
    });

    const resources = createMemo(() => {
        const states = [{ scope: 'Inbox', ...describeResource(props.inbox) }];
        if (props.selectedThreadId)
            states.push({
                scope: 'Selected history',
                ...describeResource(
                    props.history,
                    true,
                    props.history?.newerCoverageAvailable,
                ),
            });
        return states;
    });
    const state = createMemo(() =>
        resources().reduce((current, next) =>
            priority[next.kind] < priority[current.kind] ? next : current,
        ),
    );

    return (
        <span
            class="sync-orb"
            onPointerEnter={() => setOpen(true)}
            onPointerLeave={(event) => {
                if (!event.currentTarget.contains(document.activeElement))
                    setOpen(false);
            }}
        >
            <button
                class="sync-orb__target"
                type="button"
                aria-label={`Sync status: ${state().label}`}
                aria-describedby={open() ? descriptionId : undefined}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onClick={() => setOpen(true)}
            >
                <span
                    class="sync-orb__mark"
                    data-state={state().kind}
                    aria-hidden="true"
                />
            </button>
            <Show when={open()}>
                <span
                    class="sync-orb__description"
                    id={descriptionId}
                    role="tooltip"
                >
                    <For each={resources()}>
                        {(resource) => (
                            <span>
                                <strong>
                                    {resource.scope}: {resource.label}
                                </strong>
                                <span>{resource.detail}</span>
                            </span>
                        )}
                    </For>
                </span>
            </Show>
        </span>
    );
}
