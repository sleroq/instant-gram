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
import { Composer, type ThreadDraft } from './Composer';
import type {
    MutationIntent,
    Operation,
    OperationResult,
} from '../../lib/engine/operations';
import { MessageRow, dateLabel } from './MessageRow';

export function ConversationPane(props: {
    threadId: string;
    draft: ThreadDraft;
    updateDraft(value: ThreadDraft): void;
    mutate(intent: MutationIntent): Promise<OperationResult>;
    operations: readonly Operation[];
    onRetry(operationId: string): Promise<OperationResult>;
    onRemove(operationId: string): Promise<OperationResult>;
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
    let olderIntent = '';
    let newerIntent = '';
    const allIds = createMemo(() => props.history?.orderedIds || []);
    const visibleIds = createMemo(() => {
        const current = range();
        return allIds().slice(current.start, current.end);
    });
    const viewport = createHistoryViewportController(() => {
        const element = controller.element();
        if (element && followBottom) controller.scrollToBottom();
        else if (anchor) controller.correct(anchor);
        if (element && element.scrollHeight <= element.clientHeight + 1) {
            requestOlderIfNeeded();
            requestNewerIfNeeded();
        }
    });
    const controller = viewport;
    let anchor: HistoryAnchor | undefined;
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
            anchor = { ...next, followNewest: followBottom };
            props.saveAnchor(anchor);
        }
    }

    function windowKey(history: HistoryProjection) {
        return `${history.coverageGeneration}:${history.fetchedAt}:${history.orderedIds[0]}:${history.orderedIds.at(-1)}:${history.orderedIds.length}:${history.cachedNewer}:${history.newerCoverageAvailable}`;
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
        if (olderIntent === key) return;
        olderIntent = key;
        props.onLoadOlder();
    }

    function requestNewerIfNeeded(
        history = props.history,
        adoptCurrent = followBottom,
    ) {
        const element = controller.element();
        if (
            !history ||
            (!history.cachedNewer &&
                !(adoptCurrent && history.newerCoverageAvailable)) ||
            !element ||
            range().end < history.orderedIds.length ||
            element.scrollTop + element.clientHeight < element.scrollHeight - 1
        )
            return;
        const key = windowKey(history);
        if (newerIntent === key) return;
        newerIntent = key;
        if (adoptCurrent && !history.cachedNewer) {
            anchor = undefined;
            followBottom = true;
        }
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
        olderIntent = '';
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

    function moveOlderLocal() {
        const next = moveOlder(range());
        if (next.start === range().start) return false;
        capture();
        localMovePending = true;
        setRange(next);
        return true;
    }

    const [seenVersion, setSeenVersion] = createSignal(0);
    let lastRead = '';
    const [commandError, setCommandError] = createSignal('');
    const [readFailure, setReadFailure] = createSignal<{
        messageId: string;
        message: string;
    }>();
    const failedCommands = createMemo(() =>
        props.operations.filter(
            (operation) =>
                operation.intent.threadId === props.threadId &&
                operation.intent.type !== 'send' &&
                (operation.status === 'failed' ||
                    operation.status === 'outcome_unknown'),
        ),
    );
    const latestReadable = createMemo(() =>
        [...allIds()]
            .reverse()
            .map(messageFor)
            .find(
                (message) =>
                    message &&
                    !message.isSyntheticId &&
                    (!message.delivery ||
                        message.delivery.status === 'succeeded'),
            ),
    );
    createEffect(
        () => {
            const failure = readFailure();
            const latest = latestReadable();
            return (
                failure &&
                (!props.facts.threadsById[props.threadId]?.isUnread ||
                    failure.messageId !== (latest?.serverId ?? latest?.id) ||
                    props.operations.some(
                        (operation) =>
                            operation.intent.type === 'read' &&
                            operation.intent.threadId === props.threadId &&
                            operation.intent.messageId === failure.messageId,
                    ))
            );
        },
        (obsolete) => {
            if (obsolete) setReadFailure(undefined);
        },
    );
    async function changeOperation(operationId: string, remove = false) {
        setCommandError('');
        const result = await (remove
            ? props.onRemove(operationId)
            : props.onRetry(operationId));
        if (!result.ok) setCommandError(result.error.message);
    }
    createEffect(
        () =>
            failedCommands()
                .filter((operation) => operation.intent.type === 'read')
                .map((operation) => operation.operationId)
                .join(','),
        (failedIds, previous) => {
            if (failedIds && failedIds !== previous) lastRead = '';
        },
    );
    async function togglePin() {
        setCommandError('');
        const result = await props.mutate({
            type: 'pin',
            threadId: props.threadId,
            isPinned: !props.facts.threadsById[props.threadId]?.serverIsPin,
        });
        if (!result.ok) setCommandError(result.error.message);
    }
    function markSeen() {
        const element = controller.element();
        const history = props.history;

        if (
            document.visibilityState !== 'visible' ||
            !element ||
            !history ||
            !props.facts.threadsById[props.threadId]?.threadIgId ||
            history.cachedNewer ||
            history.newerCoverageAvailable ||
            range().end !== allIds().length ||
            element.scrollTop + element.clientHeight < element.scrollHeight - 1
        )
            return;

        const latest = latestReadable();
        if (
            !latest ||
            latest.id === lastRead ||
            readFailure()?.messageId === (latest.serverId ?? latest.id) ||
            failedCommands().some(
                (operation) =>
                    operation.intent.type === 'read' &&
                    operation.intent.messageId ===
                        (latest.serverId ?? latest.id),
            ) ||
            !props.facts.threadsById[props.threadId]?.isUnread
        )
            return;
        lastRead = latest.id;
        void props
            .mutate({
                type: 'read',
                threadId: props.threadId,
                messageId: latest.serverId ?? latest.id,
                timestampMs: latest.ts,
            })
            .then((result) => {
                if (!result.ok) {
                    setReadFailure({
                        messageId: latest.serverId ?? latest.id,
                        message: result.error.message,
                    });
                }
            });
    }
    const visible = () => {
        setSeenVersion((value) => value + 1);
    };
    document.addEventListener('visibilitychange', visible);
    onCleanup(() => document.removeEventListener('visibilitychange', visible));
    createEffect(
        () => [
            allIds().at(-1),
            seenVersion(),
            props.facts.threadsById[props.threadId]?.isUnread,
        ],
        () => queueMicrotask(markSeen),
    );

    function atBottom() {
        const element = controller.element();
        return Boolean(
            element &&
                element.scrollTop + element.clientHeight >=
                    element.scrollHeight - 1,
        );
    }

    function atNewest() {
        return (
            range().end === allIds().length &&
            !props.history?.cachedNewer &&
            !props.history?.newerCoverageAvailable
        );
    }

    function advanceNewer() {
        if (atNewest()) followBottom = true;
        capture();
        const next = moveNewer(range(), allIds().length);
        if (next.end !== range().end) {
            localMovePending = true;
            setRange(next);
        } else requestNewerIfNeeded(props.history, true);
    }

    function handleScroll(event: Event) {
        const element = controller.element();
        if (!element || event.currentTarget !== element) return;
        const direction = controller.scrollDirection();
        capture();
        markSeen();
        // Corrections and recycled windows do not express navigation intent.
        if (!direction) return;
        followBottom = atBottom() && atNewest();
        if (direction < 0 && element.scrollTop <= 1) {
            if (!moveOlderLocal()) requestOlderIfNeeded();
        } else if (direction > 0 && atBottom()) advanceNewer();
    }

    function forwardAtBottom(event: Event) {
        if (!atBottom()) return;
        event.preventDefault();
        advanceNewer();
    }

    let touchY = 0;

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
        ([threadId, ids, savedAnchor], previous) => {
            const previousIds = previous?.[1] ?? [];
            const idsChanged =
                ids.length !== previousIds.length ||
                ids.some((id, index) => id !== previousIds[index]);
            const threadChanged = threadId !== previous?.[0];

            if (threadChanged) {
                const savedIndex = savedAnchor
                    ? ids.indexOf(savedAnchor.id)
                    : -1;
                anchor = savedAnchor;
                followBottom = savedAnchor?.followNewest ?? false;
                if (ids.length > 0 && savedIndex < 0) anchor = undefined;
                setRange(
                    savedIndex >= 0 && !followBottom
                        ? windowContaining(ids.length, savedIndex)
                        : initialHistoryWindow(ids.length),
                );
                olderIntent = '';
                newerIntent = '';
                firstRender = true;
            } else if (
                anchor &&
                !followBottom &&
                ids.length > 0 &&
                !ids.includes(anchor.id)
            ) {
                anchor = undefined;
                setRange(initialHistoryWindow(ids.length));
                firstRender = true;
            } else if (idsChanged) {
                const target = anchor ? ids.indexOf(anchor.id) : -1;
                if (followBottom) {
                    anchor = undefined;
                    setRange(initialHistoryWindow(ids.length));
                } else if (target >= 0) {
                    setRange(windowContaining(ids.length, target));
                } else {
                    setRange(initialHistoryWindow(ids.length));
                }
            }

            queueMicrotask(() => {
                const element = controller.element();
                const history = props.history;
                if (!element) return;
                if (firstRender) {
                    followBottom ||=
                        !anchor &&
                        !history?.cachedNewer &&
                        !history?.newerCoverageAvailable;
                    if (anchor && !followBottom) controller.correct(anchor);
                    else controller.scrollToBottom();
                    firstRender = false;
                } else if (followBottom) {
                    controller.scrollToBottom();
                } else if (anchor) {
                    controller.correct(anchor);
                }
                if (localMovePending) {
                    localMovePending = false;
                    if (element.scrollHeight <= element.clientHeight + 1)
                        requestOlderIfNeeded(history);
                }
                requestNewerIfNeeded(history);
                markSeen();
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
                    aria-pressed={
                        props.facts.threadsById[props.threadId]?.serverIsPin
                            ? 'true'
                            : 'false'
                    }
                    disabled={
                        !props.facts.threadsById[props.threadId]?.threadFbid
                    }
                    onClick={() => void togglePin()}
                >
                    {props.facts.threadsById[props.threadId]?.serverIsPin
                        ? 'Unpin conversation'
                        : 'Pin conversation'}
                </button>
                <button
                    type="button"
                    onClick={refreshHistory}
                    disabled={props.history?.synchronization === 'refreshing'}
                >
                    Refresh history
                </button>
            </header>
            <Show when={commandError()}>
                <p role="alert">{commandError()}</p>
            </Show>
            <Show when={readFailure()}>
                {(failure) => (
                    <p role="alert">
                        {failure().message}{' '}
                        <button
                            type="button"
                            onClick={() => {
                                setReadFailure(undefined);
                                lastRead = '';
                                queueMicrotask(markSeen);
                            }}
                        >
                            Retry read
                        </button>
                    </p>
                )}
            </Show>
            <For each={failedCommands()}>
                {(operation) => (
                    <div role="status">
                        {operation.intent.type === 'read'
                            ? 'Mark read'
                            : 'Pin change'}
                        : {operation.error?.message ?? operation.status}
                        <Show
                            when={
                                operation.status === 'failed' &&
                                operation.retryable
                            }
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    void changeOperation(operation.operationId)
                                }
                            >
                                Retry{' '}
                                {operation.intent.type === 'read'
                                    ? 'read'
                                    : 'pin'}
                            </button>
                        </Show>
                        <button
                            type="button"
                            onClick={() =>
                                void changeOperation(
                                    operation.operationId,
                                    true,
                                )
                            }
                        >
                            Remove{' '}
                            {operation.intent.type === 'read' ? 'read' : 'pin'}
                        </button>
                    </div>
                )}
            </For>
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
                    onWheel={(event) => {
                        if (!event.ctrlKey && event.deltaY > 0)
                            forwardAtBottom(event);
                    }}
                    onKeyDown={(event) => {
                        if (
                            event.target === event.currentTarget &&
                            ['End', 'PageDown', 'ArrowDown', ' '].includes(
                                event.key,
                            ) &&
                            !event.shiftKey
                        )
                            forwardAtBottom(event);
                    }}
                    onTouchStart={(event) => {
                        touchY = event.touches[0].clientY;
                    }}
                    onTouchMove={(event) => {
                        const nextY = event.touches[0].clientY;
                        if (event.touches.length === 1 && nextY < touchY)
                            forwardAtBottom(event);
                        touchY = nextY;
                    }}
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
                            const continuesSender = () => {
                                const current = message();
                                const previous = prior();
                                return Boolean(
                                    current &&
                                        previous &&
                                        'senderId' in current &&
                                        'senderId' in previous &&
                                        current.senderId === previous.senderId,
                                );
                            };
                            const groupStart = () =>
                                !continuesSender() ||
                                newDate() ||
                                message()!.ts - prior()!.ts > 5 * 60_000;

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
                                                onReply={() =>
                                                    props.updateDraft({
                                                        ...props.draft,
                                                        replyTo:
                                                            resolved()
                                                                .serverId ??
                                                            resolved().id,
                                                        version:
                                                            props.draft
                                                                .version + 1,
                                                    })
                                                }
                                                onRetry={(id) =>
                                                    void changeOperation(id)
                                                }
                                                onRemove={(id) =>
                                                    void changeOperation(
                                                        id,
                                                        true,
                                                    )
                                                }
                                                user={userFor(id)}
                                                outgoing={outgoing(id)}
                                                groupStart={groupStart()}
                                                senderRunStart={
                                                    index() === 0 ||
                                                    !continuesSender()
                                                }
                                                isGroup={
                                                    props.facts.threadsById[
                                                        props.threadId
                                                    ]?.isGroup ?? false
                                                }
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
            <Show
                when={
                    props.facts.threadsById[props.threadId]?.threadFbid &&
                    props.history?.viewerId
                }
            >
                <Composer
                    threadId={props.threadId}
                    draft={props.draft}
                    update={props.updateDraft}
                    reply={
                        props.draft.replyTo
                            ? messageFor(props.draft.replyTo)
                            : undefined
                    }
                    mutate={props.mutate}
                    onResize={controller.setBottomClearance}
                    beforeSend={() => {
                        const element = controller.element();
                        followBottom = Boolean(
                            element &&
                                element.scrollTop + element.clientHeight >=
                                    element.scrollHeight - 1 &&
                                atNewest(),
                        );
                        if (followBottom) anchor = undefined;
                        else capture();
                    }}
                />
            </Show>
        </section>
    );
}
