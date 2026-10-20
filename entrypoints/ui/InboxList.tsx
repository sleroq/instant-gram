import {
    createEffect,
    createMemo,
    createSignal,
    For,
    onCleanup,
    Show,
} from 'solid-js';
import type { EntityFacts, ResourceProjection } from '../../lib/engine/inbox';
import { computeChatWindow, type ListAnchor } from './virtual-list';

function preview(facts: EntityFacts, id: string) {
    const thread = facts.threadsById[id];
    const message = thread?.lastMessageId
        ? facts.messagesById[thread.lastMessageId]
        : undefined;
    if (!message) return 'No messages yet';
    switch (message.kind) {
        case 'text':
        case 'activity':
            return message.text || 'Message';
        case 'reaction_log':
            return message.fragment || 'Reaction';
        case 'reel_share':
            return message.caption || `Shared a ${message.mediaType}`;
        case 'inline_share':
            return message.title || 'Shared a post';
        case 'image':
            return message.images.length === 1
                ? 'Photo'
                : `${message.images.length} photos`;
        case 'unsupported':
            return message.fallback.preview || message.fallback.label;
    }
}

function initials(title: string) {
    return title
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

export function InboxList(props: {
    facts: EntityFacts;
    resource: ResourceProjection;
    selectedId?: string;
    onSelect(id: string): void;
    onRefresh(): void;
    onLoadMore(): void;
    restore?: ListAnchor;
    restoreFocus?: boolean;
    onPosition?(anchor: ListAnchor): void;
}) {
    const [scrollTop, setScrollTop] = createSignal(0);
    const orderedIds = createMemo(() => {
        const pinned: string[] = [];
        const unpinned: string[] = [];
        for (const id of props.resource.orderedIds) {
            (props.facts.threadsById[id]?.serverIsPin ? pinned : unpinned).push(
                id,
            );
        }
        return [...pinned, ...unpinned];
    });
    const chatWindow = createMemo(() =>
        computeChatWindow(scrollTop(), orderedIds().length),
    );
    const ids = createMemo(() =>
        orderedIds().slice(chatWindow().start, chatWindow().end),
    );
    let viewport: HTMLDivElement | undefined;
    let allowRestore = true;

    const savePosition = (focusId?: string) => {
        if (!viewport) return;
        allowRestore = false;
        const boundary =
            viewport.getBoundingClientRect().top + viewport.clientTop;
        const row = [
            ...viewport.querySelectorAll<HTMLElement>('[data-thread-id]'),
        ].find((item) => item.getBoundingClientRect().bottom > boundary);
        if (!row) return;
        props.onPosition?.({
            id: row.dataset.threadId,
            offset: row.getBoundingClientRect().top - boundary,
            focusId:
                focusId ||
                (document.activeElement instanceof HTMLElement
                    ? document.activeElement.dataset.threadId
                    : undefined),
        });
    };
    const retryResource = () => {
        if (props.resource.failedOperation === 'continuation')
            props.onLoadMore();
        else props.onRefresh();
    };
    onCleanup(savePosition);
    createEffect(
        () => ({ restore: props.restore, ordered: orderedIds() }),
        ({ restore, ordered }) => {
            const id = restore?.id;
            if (!id || !allowRestore) return;
            const index = ordered.indexOf(id);
            if (index < 0) return;
            queueMicrotask(() => {
                const element = viewport;
                if (!element || !allowRestore) return;
                allowRestore = false;
                element.scrollTop = Math.max(
                    0,
                    index * 72 - (restore.offset || 0),
                );
                setScrollTop(element.scrollTop);
                if (props.restoreFocus === false) return;
                const focusId = restore.focusId || id;
                queueMicrotask(() =>
                    element
                        .querySelector<HTMLButtonElement>(
                            `[data-thread-id="${CSS.escape(focusId)}"]`,
                        )
                        ?.focus({ preventScroll: true }),
                );
            });
        },
    );

    return (
        <section class="solid-inbox__list-panel" aria-label="Inbox">
            <div class="solid-inbox__list-heading">
                <div>
                    <p class="solid-inbox__eyebrow">Read-only inbox</p>
                    <h1>Messages</h1>
                </div>
                <button
                    type="button"
                    onClick={() => props.onRefresh()}
                    disabled={props.resource.synchronization === 'refreshing'}
                >
                    Refresh
                </button>
            </div>
            <p class="solid-inbox__status" role="status">
                {props.resource.availability === 'absent'
                    ? props.resource.synchronization === 'refreshing'
                        ? 'Checking Instagram…'
                        : 'Inbox unavailable'
                    : props.resource.synchronization === 'refreshing'
                      ? 'Showing cached conversations · Refreshing…'
                      : props.resource.freshness === 'stale'
                        ? 'Showing cached conversations'
                        : 'Up to date'}
            </p>
            <Show when={props.resource.error}>
                <p class="solid-inbox__error" role="alert">
                    {props.resource.error?.message}{' '}
                    <button type="button" onClick={retryResource}>
                        Retry
                    </button>
                </p>
            </Show>
            <div
                class="solid-inbox__viewport"
                role="region"
                aria-label="Primary inbox"
                tabindex={0}
                ref={(element) => (viewport = element)}
                onScroll={(event) => {
                    const element = event.currentTarget;
                    setScrollTop(element.scrollTop);
                    savePosition();
                }}
            >
                <ul
                    aria-label="Conversations"
                    style={{
                        height: `${orderedIds().length * 72}px`,
                    }}
                >
                    <For each={ids()}>
                        {(id, index) => {
                            const thread = () => props.facts.threadsById[id];

                            return (
                                <li
                                    class="solid-inbox__thread-slot"
                                    style={{
                                        transform: `translateY(${(chatWindow().start + index()) * 72}px)`,
                                    }}
                                >
                                    <button
                                        type="button"
                                        class="solid-inbox__thread"
                                        data-thread-id={id}
                                        aria-current={
                                            props.selectedId === id
                                                ? 'page'
                                                : undefined
                                        }
                                        onClick={() => {
                                            savePosition(id);
                                            props.onSelect(id);
                                        }}
                                    >
                                        <span
                                            class="solid-inbox__avatar"
                                            aria-hidden="true"
                                        >
                                            {initials(
                                                thread()?.title ||
                                                    'Conversation',
                                            )}
                                        </span>
                                        <span class="solid-inbox__thread-copy">
                                            <span class="solid-inbox__thread-title">
                                                <strong>
                                                    {thread()?.title ||
                                                        'Conversation'}
                                                </strong>
                                                <Show
                                                    when={thread()?.serverIsPin}
                                                >
                                                    <svg
                                                        class="solid-inbox__pin"
                                                        aria-label="Pinned"
                                                        viewBox="0 0 16 16"
                                                    >
                                                        <path d="M10.7 1.5 14.5 5.3l-1.4 1.4-.8-.8-2.6 3 .4 1.8-1.2 1.2-2.1-2.1-3.5 3.5-.6-.6 3.5-3.5-2.1-2.1 1.2-1.2 1.8.4 3-2.6-.8-.8 1.4-1.4Z" />
                                                    </svg>
                                                </Show>
                                            </span>
                                            <span>
                                                {preview(props.facts, id)}
                                            </span>
                                        </span>
                                        <Show when={thread()?.isUnread}>
                                            <span
                                                class="solid-inbox__unread"
                                                aria-label="Unread"
                                            />
                                        </Show>
                                    </button>
                                </li>
                            );
                        }}
                    </For>
                </ul>
            </div>
            <Show
                when={
                    props.resource.hasNextPage &&
                    !props.resource.retentionLimited
                }
            >
                <div class="solid-inbox__list-footer">
                    <Show
                        when={props.resource.synchronization === 'error'}
                        fallback={
                            <button
                                type="button"
                                onClick={() => props.onLoadMore()}
                            >
                                Load more conversations
                            </button>
                        }
                    >
                        <button
                            type="button"
                            onClick={() => props.onLoadMore()}
                        >
                            Retry older conversations
                        </button>
                    </Show>
                </div>
            </Show>
            <Show when={props.resource.retentionLimited}>
                <p class="solid-inbox__limit">Retained inbox limit reached</p>
            </Show>
        </section>
    );
}
