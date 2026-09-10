import { createMemo, createSignal, For, Show } from 'solid-js';
import type { Message } from '../../lib/domain';
import type { InboxData } from '../../lib/engine/inbox';
import { computeChatWindow } from './virtual-list';
import { createInboxClient } from './client';

function preview(message: Message | undefined) {
    if (!message) return '';
    if (message.kind === 'text' || message.kind === 'activity')
        return message.text;
    if (message.kind === 'reaction_log') return message.fragment;
    if (message.kind === 'reel_share')
        return (
            message.caption ?? `${message.author} shared a ${message.mediaType}`
        );
    if (message.kind === 'inline_share') return message.title;
    if (message.kind === 'image') return 'Photo';
    return message.fallback.preview ?? message.fallback.label;
}

function ThreadRow(props: { id: string; inbox: InboxData; index: number }) {
    const thread = () => props.inbox.threadsById[props.id];
    const message = () => {
        const id = thread().lastMessageId;
        return id ? props.inbox.messagesById[id] : undefined;
    };
    return (
        <li style={{ transform: `translateY(${props.index * 72}px)` }}>
            <span class="solid-inbox__avatar" aria-hidden="true">
                {thread().title.slice(0, 2).toUpperCase()}
            </span>
            <div>
                <strong>{thread().title}</strong>
                <p>{preview(message())}</p>
            </div>
            <Show when={thread().isUnread}>
                <span class="solid-inbox__unread">Unread</span>
            </Show>
        </li>
    );
}

function InboxList(props: { inbox: InboxData }) {
    const [scrollTop, setScrollTop] = createSignal(0);
    const chatWindow = createMemo(() =>
        computeChatWindow(scrollTop(), props.inbox.orderedIds.length),
    );
    const ids = createMemo(() =>
        props.inbox.orderedIds.slice(chatWindow().start, chatWindow().end),
    );
    return (
        <div
            class="solid-inbox__viewport"
            role="region"
            aria-label="Primary inbox"
            tabindex={0}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
            <ul
                aria-label="Conversations"
                style={{ height: `${props.inbox.orderedIds.length * 72}px` }}
            >
                <For each={ids()}>
                    {(id, index) => (
                        <ThreadRow
                            id={id}
                            inbox={props.inbox}
                            index={chatWindow().start + index()}
                        />
                    )}
                </For>
            </ul>
        </div>
    );
}

export default function App() {
    const client = createInboxClient();
    const status = createMemo(() => {
        if (client.state.availability === 'absent') {
            return client.state.synchronization === 'refreshing'
                ? 'Checking Instagram…'
                : 'Inbox unavailable';
        }
        if (client.state.synchronization === 'refreshing')
            return 'Showing cached conversations · Refreshing…';
        if (client.state.freshness === 'stale')
            return 'Showing cached conversations';
        return 'Up to date';
    });
    return (
        <main class="solid-inbox">
            <header>
                <div>
                    <p>Read-only inbox</p>
                    <h1>Messages</h1>
                </div>
                <button
                    type="button"
                    onClick={() => client.refresh()}
                    disabled={client.state.synchronization === 'refreshing'}
                >
                    Refresh
                </button>
            </header>
            <p class="solid-inbox__status" role="status">
                {status()}
            </p>
            <Show when={client.state.error}>
                <p class="solid-inbox__error" role="alert">
                    {client.state.error?.message}{' '}
                    <button type="button" onClick={() => client.refresh()}>
                        Retry
                    </button>
                </p>
            </Show>
            <Show when={client.state.inbox} keyed>
                {(inbox) => (
                    <Show
                        when={inbox.orderedIds.length > 0}
                        fallback={
                            <p class="solid-inbox__empty">
                                No conversations in your primary inbox.
                            </p>
                        }
                    >
                        <InboxList inbox={inbox} />
                    </Show>
                )}
            </Show>
        </main>
    );
}
