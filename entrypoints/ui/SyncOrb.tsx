import {
    createEffect,
    createMemo,
    createSignal,
    createUniqueId,
    Show,
} from 'solid-js';
import type { ResourceProjection } from '../../lib/engine/inbox';

/** Presentation only: each caller supplies its own worker resource. */
export function SyncOrb(props: {
    resource?: ResourceProjection;
    scope: 'Inbox' | 'History';
    newerCoverageAvailable?: boolean;
}) {
    const descriptionId = createUniqueId();
    const [open, setOpen] = createSignal(false);
    let target: HTMLButtonElement | undefined;
    let description: HTMLSpanElement | undefined;
    createEffect(open, (visible) => {
        if (!visible) return;
        function placeDescription() {
            if (!target || !description?.isConnected) return;
            const left = target.getBoundingClientRect().left;
            description.style.left = `${Math.min(0, window.innerWidth - 12 - left - description.offsetWidth)}px`;
        }
        function dismiss(event: KeyboardEvent) {
            if (event.key === 'Escape') setOpen(false);
        }
        queueMicrotask(placeDescription);
        window.addEventListener('resize', placeDescription);
        document.addEventListener('keydown', dismiss);
        return () => {
            window.removeEventListener('resize', placeDescription);
            document.removeEventListener('keydown', dismiss);
        };
    });

    const state = createMemo(() => {
        const resource = props.resource;
        if (resource?.error || resource?.synchronization === 'error')
            return {
                kind: 'failed',
                label: 'Sync failed',
                symbol: '!',
                detail:
                    resource?.availability === 'present'
                        ? 'Loaded content remains available. See the error and recovery controls.'
                        : 'Content is unavailable. See the error and recovery controls.',
            };

        if (
            !resource ||
            (resource.availability === 'absent' &&
                resource.synchronization === 'refreshing')
        )
            return {
                kind: 'loading',
                label: 'Loading',
                symbol: '…',
                detail: 'Waiting for initial content. The worker request may be queued or in progress.',
            };

        if (resource.synchronization === 'refreshing')
            return {
                kind: 'refreshing',
                label: 'Refreshing',
                symbol: '↻',
                detail: 'Loaded content remains available while the worker checks for updates. The request may be queued or in progress.',
            };

        if (resource.availability === 'absent')
            return {
                kind: 'unavailable',
                label: 'Unavailable',
                symbol: '−',
                detail: 'No content is currently available.',
            };

        if (resource.freshness === 'stale' || props.newerCoverageAvailable)
            return {
                kind: 'retained',
                label: 'Retained content',
                symbol: '◷',
                detail:
                    props.scope === 'History'
                        ? 'Showing retained history. It does not establish current or complete coverage. Newer messages may be available.'
                        : 'Showing cached conversations. Updates have not been confirmed.',
            };

        return {
            kind: 'fresh',
            label: 'Fresh',
            symbol: '✓',
            detail:
                props.scope === 'History'
                    ? 'Loaded history is fresh. More messages may exist outside this window.'
                    : 'Loaded conversations are up to date.',
        };
    });

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
                ref={(element) => (target = element)}
                type="button"
                aria-label={`${props.scope} sync: ${state().label}`}
                aria-describedby={open() ? descriptionId : undefined}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onClick={() => setOpen(true)}
            >
                <span
                    class="sync-orb__mark"
                    data-state={state().kind}
                    aria-hidden="true"
                >
                    {state().symbol}
                </span>
            </button>
            <Show when={open()}>
                <span
                    class="sync-orb__description"
                    ref={(element) => (description = element)}
                    id={descriptionId}
                    role="tooltip"
                >
                    <strong>
                        {props.scope}: {state().label}
                    </strong>
                    <span>{state().detail}</span>
                </span>
            </Show>
        </span>
    );
}
