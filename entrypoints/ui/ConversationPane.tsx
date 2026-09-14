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

function failedOperation(history: HistoryProjection | undefined) {
    if (history && 'failedOperation' in history) return history.failedOperation;
    return undefined;
}

export function ConversationPane(props: {
    threadId: string;
    facts: EntityFacts;
    history: HistoryProjection | undefined;
    onBack(): void;
    onRefresh(): void;
    onLoadOlder(): void;
    compact: boolean;
    savedAnchor?: HistoryAnchor;
    saveAnchor(anchor: HistoryAnchor | undefined): void;
}) {
    const [range, setRange] = createSignal<HistoryWindow>({ start: 0, end: 0 });
    const [olderIntent, setOlderIntent] = createSignal('');
    const allIds = createMemo(() => props.history?.orderedIds || []);
    const visibleIds = createMemo(() => {
        const current = range();
        return allIds().slice(current.start, current.end);
    });
    const viewport = createHistoryViewportController(() => {
        if (anchor) controller.correct(anchor);
        const element = controller.element();
        if (element && element.scrollHeight <= element.clientHeight + 1)
            requestOlderIfNeeded();
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

    function requestOlderIfNeeded() {
        const history = props.history;
        const element = controller.element();
        if (
            !history ||
            history.retentionLimited ||
            history.synchronization !== 'idle' ||
            !history.hasNextPage ||
            range().start !== 0 ||
            (element && element.scrollTop > 1)
        )
            return;
        const key = `${history.fetchedAt}:${history.orderedIds.length}`;
        if (olderIntent() === key) return;
        setOlderIntent(key);
        props.onLoadOlder();
    }

    function retryOlder() {
        const history = props.history;
        if (!history || history.retentionLimited || !history.hasNextPage)
            return;
        setOlderIntent('');
        capture();
        props.onLoadOlder();
    }

    function retryHistoryError() {
        if (failedOperation(props.history) === 'continuation') retryOlder();
        else props.onRefresh();
    }

    function moveOlderLocal() {
        const next = moveOlder(range());
        if (next.start === range().start) return false;
        capture();
        localMovePending = true;
        setRange(next);
        return true;
    }

    function handleScroll() {
        capture();
        const element = controller.element();
        if (!element) return;
        if (element.scrollTop <= 1) {
            if (!moveOlderLocal()) requestOlderIfNeeded();
        } else if (
            element.scrollTop + element.clientHeight >=
            element.scrollHeight - 1
        ) {
            const next = moveNewer(range(), allIds().length);
            if (next.end !== range().end) {
                anchor = undefined;
                followBottom = true;
                setRange(next);
            }
        }
    }

    createEffect(
        () =>
            [
                props.threadId,
                allIds().join('\u0000'),
                range().start,
                range().end,
            ] as const,
        ([threadId, idsKey], previous) => {
            const ids = allIds();
            const previousKey = previous?.[1];
            const threadChanged = threadId !== previous?.[0];
            if (threadChanged) {
                const savedIndex = props.savedAnchor
                    ? ids.indexOf(props.savedAnchor.id)
                    : -1;
                anchor = savedIndex >= 0 ? props.savedAnchor : undefined;
                setRange(
                    savedIndex >= 0
                        ? windowContaining(ids.length, savedIndex)
                        : initialHistoryWindow(ids.length),
                );
                setOlderIntent('');
                firstRender = true;
            } else if (anchor && !ids.includes(anchor.id)) {
                anchor = undefined;
                setRange(initialHistoryWindow(ids.length));
                firstRender = true;
            } else if (idsKey !== previousKey) {
                const old = previousIds;
                const prepended =
                    old.length > 0 &&
                    ids.length > old.length &&
                    old.every(
                        (id, index) =>
                            ids[ids.length - old.length + index] === id,
                    );
                const appended =
                    old.length > 0 &&
                    ids.length > old.length &&
                    old.every((id, index) => ids[index] === id);
                const target = anchor ? ids.indexOf(anchor.id) : -1;
                if (prepended && target >= 0) {
                    setRange(windowContaining(ids.length, target));
                } else if (appended && followBottom) {
                    followBottom = false;
                    anchor = undefined;
                    setRange(initialHistoryWindow(ids.length));
                } else if (target >= 0) {
                    setRange(windowContaining(ids.length, target));
                } else {
                    setRange(initialHistoryWindow(ids.length));
                }
            }
            previousIds = [...ids];
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
                        requestOlderIfNeeded();
                }
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
                    onClick={() => props.onRefresh()}
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
                            props.history?.hasNextPage &&
                            !props.history?.retentionLimited &&
                            (!props.history?.error ||
                                failedOperation(props.history) ===
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
