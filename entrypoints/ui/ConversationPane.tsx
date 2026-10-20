import {
    createEffect,
    createMemo,
    createSignal,
    For,
    onCleanup,
    Show,
} from 'solid-js';
import type { EntityFacts, HistoryProjection } from '../../lib/engine/inbox';
import {
    initialHistoryWindow,
    moveNewer,
    moveOlder,
    windowContaining,
    type HistoryAnchor,
    type HistoryWindow,
} from './history-window';
import { createHistoryViewportController } from './history-viewport';
import { MessageRow, dateLabel } from './MessageRow';

export function ConversationPane(props: {
    threadId: string;
    facts: EntityFacts;
    history: HistoryProjection | undefined;
    onBack(): void;
    onRefresh(anchorId?: string): void;
    onLoadOlder(): void;
    onLoadNewer(): void;
    compact: boolean;
    savedAnchor?: HistoryAnchor;
    saveAnchor(anchor: HistoryAnchor | undefined): void;
}) {
    const [range, setRange] = createSignal<HistoryWindow>({ start: 0, end: 0 });
    const [olderIntent, setOlderIntent] = createSignal('');
    const [newerIntent, setNewerIntent] = createSignal('');
    const allIds = createMemo(() => props.history?.orderedIds || []);
    const visibleIds = createMemo(() => {
        const current = range();
        return allIds().slice(current.start, current.end);
    });
    const viewport = createHistoryViewportController(() => {
        if (anchor) controller.correct(anchor);
        const element = controller.element();
        if (element && element.scrollHeight <= element.clientHeight + 1) {
            requestOlderIfNeeded();
            requestNewerIfNeeded();
        }
    });
    const controller = viewport;
    let anchor: HistoryAnchor | undefined;
    let previousIds: string[] = [];
    let firstRender = true;
    let localMovePending = false;
    let followBottom = false;

    const messageFor = (id: string) => props.facts.messagesById[id];
    const userFor = (id: string) => {
        const message = messageFor(id);
        return message && 'senderId' in message
            ? props.facts.usersById[message.senderId]
            : undefined;
    };
    const outgoing = (id: string) => {
        const message = messageFor(id);
        return Boolean(
            message &&
                'senderId' in message &&
                props.history?.viewerId &&
                message.senderId === props.history.viewerId,
        );
    };

    function capture() {
        const next = controller.capture();
        if (next) {
            anchor = next;
            props.saveAnchor(next);
        }
    }

    function windowKey(history: HistoryProjection) {
        return `${history.fetchedAt}:${history.orderedIds[0]}:${history.orderedIds.at(-1)}:${history.orderedIds.length}`;
    }

    function requestOlderIfNeeded(history = props.history) {
        const element = controller.element();
        if (
            !history ||
            (!history.cachedOlder &&
                (history.retentionLimited ||
                    history.synchronization !== 'idle' ||
                    !history.hasNextPage)) ||
            range().start !== 0 ||
            (element && element.scrollTop > 1)
        )
            return;
        const key = windowKey(history);
        if (olderIntent() === key) return;
        setOlderIntent(key);
        props.onLoadOlder();
    }

    function requestNewerIfNeeded(history = props.history) {
        const element = controller.element();
        if (
            !history?.cachedNewer ||
            !element ||
            range().end < history.orderedIds.length ||
            element.scrollTop + element.clientHeight < element.scrollHeight - 1
        )
            return;
        const key = windowKey(history);
        if (newerIntent() === key) return;
        setNewerIntent(key);
        props.onLoadNewer();
    }

    function retryOlder() {
        const history = props.history;
        if (
            !history ||
            (!history.cachedOlder &&
                (history.retentionLimited || !history.hasNextPage))
        )
            return;
        setOlderIntent('');
        capture();
        props.onLoadOlder();
    }

    function refreshHistory() {
        capture();
        props.onRefresh(anchor?.id);
    }

    function retryHistoryError() {
        if (props.history?.failedOperation === 'continuation') retryOlder();
        else refreshHistory();
    }

    function showLatest() {
        anchor = undefined;
        followBottom = true;
        firstRender = true;
        props.onLoadNewer();
    }

    function moveOlderLocal() {
        const next = moveOlder(range());
        if (next.start === range().start) return false;
        capture();
        localMovePending = true;
        setRange(next);
        return true;
    }

    function handleScroll(event: Event) {
        const element = controller.element();
        if (!element || event.currentTarget !== element) return;
        capture();
        const atBottom =
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 1;
        followBottom =
            atBottom &&
            range().end === allIds().length &&
            !props.history?.cachedNewer;
        if (element.scrollTop <= 1) {
            if (!moveOlderLocal()) requestOlderIfNeeded();
        } else if (atBottom) {
            const next = moveNewer(range(), allIds().length);
            if (next.end !== range().end) {
                localMovePending = true;
                setRange(next);
            } else requestNewerIfNeeded();
        }
    }

    createEffect(
        () => {
            const ids = [...allIds()];
            const history = props.history;
            return [
                props.threadId,
                ids,
                props.savedAnchor,
                range().start,
                range().end,
                history ? { ...history, orderedIds: ids } : undefined,
            ] as const;
        },
        ([threadId, ids, savedAnchor, , , history], previous) => {
            const idsChanged =
                ids.length !== previousIds.length ||
                ids.some((id, index) => id !== previousIds[index]);
            const threadChanged = threadId !== previous?.[0];

            if (threadChanged) {
                const savedIndex = savedAnchor
                    ? ids.indexOf(savedAnchor.id)
                    : -1;
                anchor = savedAnchor;
                if (ids.length > 0 && savedIndex < 0) anchor = undefined;
                setRange(
                    savedIndex >= 0
                        ? windowContaining(ids.length, savedIndex)
                        : initialHistoryWindow(ids.length),
                );
                setOlderIntent('');
                setNewerIntent('');
                firstRender = true;
            } else if (anchor && ids.length > 0 && !ids.includes(anchor.id)) {
                anchor = undefined;
                setRange(initialHistoryWindow(ids.length));
                firstRender = true;
            } else if (idsChanged) {
                const target = anchor ? ids.indexOf(anchor.id) : -1;
                if (followBottom && !history?.cachedNewer) {
                    anchor = undefined;
                    setRange(initialHistoryWindow(ids.length));
                } else if (target >= 0) {
                    setRange(windowContaining(ids.length, target));
                } else {
                    setRange(initialHistoryWindow(ids.length));
                }
            }

            previousIds = ids;
            queueMicrotask(() => {
                const element = controller.element();
                if (!element) return;
                if (firstRender) {
                    if (anchor) controller.correct(anchor);
                    else element.scrollTop = element.scrollHeight;
                    firstRender = false;
                } else if (anchor) {
                    controller.correct(anchor);
                } else if (followBottom) {
                    element.scrollTop = element.scrollHeight;
                    followBottom = false;
                }
                if (localMovePending) {
                    localMovePending = false;
                    if (element.scrollHeight <= element.clientHeight + 1)
                        requestOlderIfNeeded(history);
                }
                requestNewerIfNeeded(history);
            });
        },
    );

    onCleanup(() => {
        capture();
        controller.dispose();
    });

    return (
        <section class="solid-conversation" aria-label="Conversation">
            <header class="solid-conversation__header">
                <Show when={props.compact}>
                    <button
                        type="button"
                        onClick={() => {
                            capture();
                            props.onBack();
                        }}
                    >
                        Back
                    </button>
                </Show>
                <div>
                    <h2>
                        {props.facts.threadsById[props.threadId]?.title ||
                            'Conversation'}
                    </h2>
                    <Show when={props.history?.freshness === 'stale'}>
                        <p>Showing retained history</p>
                    </Show>
                </div>
                <button
                    type="button"
                    onClick={refreshHistory}
                    disabled={props.history?.synchronization === 'refreshing'}
                >
                    Refresh history
                </button>
            </header>
            <Show when={props.history?.error}>
                <p class="solid-inbox__error" role="alert">
                    {props.history?.error?.message}{' '}
                    <button type="button" onClick={retryHistoryError}>
                        Retry
                    </button>
                </p>
            </Show>
            <Show
                when={
                    props.history?.availability === 'present' &&
                    allIds().length > 0
                }
                fallback={
                    <div class="solid-conversation__empty">
                        <Show
                            when={props.history?.synchronization === 'error'}
                            fallback={
                                <p>
                                    {!props.history
                                        ? 'Loading history…'
                                        : props.history.synchronization ===
                                            'refreshing'
                                          ? 'Checking history…'
                                          : props.history.retentionLimited
                                            ? 'Retained history limit reached'
                                            : 'No retained messages.'}
                                </p>
                            }
                        >
                            <p role="alert">History could not be loaded.</p>
                            <button type="button" onClick={retryHistoryError}>
                                Retry history
                            </button>
                        </Show>
                    </div>
                }
            >
                <div
                    class="solid-history__viewport"
                    ref={(element) => controller.attach(element)}
                    onScroll={handleScroll}
                    tabindex={0}
                    aria-label="Messages"
                >
                    <Show
                        when={
                            range().start === 0 &&
                            (props.history?.cachedOlder ||
                                (props.history?.hasNextPage &&
                                    !props.history?.retentionLimited)) &&
                            (props.history?.cachedOlder ||
                                !props.history?.error ||
                                props.history?.failedOperation ===
                                    'continuation')
                        }
                    >
                        <button
                            class="solid-history__older"
                            type="button"
                            onClick={retryOlder}
                        >
                            {props.history?.synchronization === 'error'
                                ? 'Retry older messages'
                                : 'Load older messages'}
                        </button>
                    </Show>
                    <For each={visibleIds()}>
                        {(id, index) => {
                            const message = () => messageFor(id);
                            const prior = () =>
                                messageFor(
                                    allIds()[range().start + index() - 1],
                                );
                            const newDate = () => {
                                const current = message();
                                const previous = prior();
                                return Boolean(
                                    current &&
                                        (!previous ||
                                            dateLabel(current.ts) !==
                                                dateLabel(previous.ts)),
                                );
                            };
                            const showSender = () => {
                                const current = message();
                                const previous = prior();
                                return Boolean(
                                    current &&
                                        'senderId' in current &&
                                        (!previous ||
                                            !('senderId' in previous) ||
                                            current.senderId !==
                                                previous.senderId),
                                );
                            };

                            return (
                                <>
                                    <Show when={newDate()}>
                                        <div
                                            class="solid-history__date"
                                            aria-label={dateLabel(
                                                message()!.ts,
                                            )}
                                        >
                                            {dateLabel(message()!.ts)}
                                        </div>
                                    </Show>
                                    <Show when={message()}>
                                        {(resolved) => (
                                            <MessageRow
                                                message={resolved()}
                                                user={userFor(id)}
                                                outgoing={outgoing(id)}
                                                showSender={showSender()}
                                            />
                                        )}
                                    </Show>
                                </>
                            );
                        }}
                    </For>
                    <Show
                        when={
                            props.history?.newerCoverageAvailable &&
                            !props.history?.cachedNewer &&
                            range().end === allIds().length
                        }
                    >
                        <button
                            class="solid-history__older"
                            type="button"
                            onClick={showLatest}
                        >
                            Show latest messages
                        </button>
                    </Show>
                    <Show when={props.history?.retentionLimited}>
                        <p class="solid-history__retention">
                            Retained history limit reached
                        </p>
                    </Show>
                </div>
            </Show>
        </section>
    );
}
