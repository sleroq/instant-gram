import type { UIEvent } from 'react';
import { useEffect, useMemo, useState } from '../../vendor/teact/src/teact/teact';
import type { Message, Thread } from '../../lib/domain';
import type { FrontendStore, HistoryState } from './store';
import { computeChatWindow } from './virtual-list';

const ROW_HEIGHT = 72;

type AppProps = { store: FrontendStore };

export default function App({ store }: AppProps) {
    useStore(store);
    const state = store.state;
    const selected = state.selectedThreadId
        ? state.inbox.byId[state.selectedThreadId]
        : undefined;

    return (
        <main className="app-shell">
            <aside className="sidebar">
                <header className="sidebar__header">
                    <span className="brand-mark">IC</span>
                    <div>
                        <h1>Messages</h1>
                        <p>Instagram inbox</p>
                    </div>
                </header>
                <ChatList store={store} />
            </aside>
            <section className="conversation">
                {selected ? (
                    <MessagePane
                        store={store}
                        thread={selected}
                        history={state.histories[selected.key]}
                    />
                ) : (
                    <div className="conversation-state conversation-state--welcome">
                        <div className="welcome-icon">✦</div>
                        <h2>Select a conversation</h2>
                        <p>Choose a chat to view its recent messages.</p>
                    </div>
                )}
            </section>
        </main>
    );
}

function ChatList({ store }: AppProps) {
    const [scrollTop, setScrollTop] = useState(0);
    const state = store.state;
    const ids = store.orderedThreadIds();
    const { start, end } = computeChatWindow(scrollTop, ids.length);
    const visibleIds = ids.slice(start, end);
    const visibleKey = visibleIds.join('\u0000');
    const selectedHistoryStatus = state.selectedThreadId
        ? state.histories[state.selectedThreadId]?.status
        : undefined;

    useEffect(() => {
        if (end >= ids.length - 5) store.loadNextInboxPage();
        store.warmVisibleThreads(visibleIds);
    }, [
        visibleKey,
        ids.length,
        end,
        state.inbox.status,
        state.inbox.isLoadingMore,
        state.selectedThreadId,
        selectedHistoryStatus,
    ]);

    if (state.inbox.status === 'loading' && ids.length === 0) {
        return <ListState label="Loading conversations…" spinner />;
    }
    if (state.inbox.status === 'error' && ids.length === 0) {
        return (
            <ListState
                label={state.inbox.error ?? 'Could not load inbox'}
                error
                actionLabel="Retry"
                onAction={store.retryInbox}
            />
        );
    }
    if (state.inbox.status === 'ready' && ids.length === 0) {
        return <ListState label="Your inbox is empty" />;
    }

    return (
        <div
            className="chat-list"
            onScroll={(event: UIEvent<HTMLDivElement>) =>
                setScrollTop(event.currentTarget.scrollTop)
            }
        >
            <div
                className="chat-list__spacer"
                style={{ height: `${ids.length * ROW_HEIGHT}px` }}
                teactFastList
            >
                {visibleIds.map((id, offset) => (
                    <ChatRow
                        key={id}
                        thread={state.inbox.byId[id]}
                        index={start + offset}
                        selected={id === state.selectedThreadId}
                        pinned={state.pinnedIds.includes(id)}
                        onSelect={() => store.selectThread(id)}
                    />
                ))}
            </div>
            {state.inbox.isLoadingMore && (
                <div className="chat-list__tail" role="status">Loading more…</div>
            )}
            {state.inbox.error && ids.length > 0 && (
                <div className="chat-list__tail chat-list__tail--error" role="alert">
                    <span>{state.inbox.error}</span>
                    <button type="button" onClick={store.retryInbox}>Retry</button>
                </div>
            )}
        </div>
    );
}

type ChatRowProps = {
    thread: Thread;
    index: number;
    selected: boolean;
    pinned: boolean;
    onSelect: () => void;
};

function ChatRow({ thread, index, selected, pinned, onSelect }: ChatRowProps) {
    const user = thread.users[0];
    const snippet = thread.lastMessage ? messageSummary(thread.lastMessage) : 'No messages yet';
    return (
        <button
            className={`chat-row${selected ? ' chat-row--selected' : ''}`}
            style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`${thread.title}${thread.isMuted ? ', muted' : ''}${pinned ? ', pinned' : ''}`}
        >
            <span className="avatar">
                {user?.picUrl ? (
                    <img src={user.picUrl} alt="" width="52" height="52" loading="lazy" />
                ) : (
                    <span>{initials(thread.title)}</span>
                )}
            </span>
            <span className="chat-row__body">
                <span className="chat-row__topline">
                    <strong>{thread.title}</strong>
                    <time dateTime={new Date(thread.lastActivityMs).toISOString()}>
                        {formatThreadTime(thread.lastActivityMs)}
                    </time>
                </span>
                <span className="chat-row__bottomline">
                    <span className="chat-row__snippet">{snippet}</span>
                    <span className="chat-row__badges">
                        {thread.isMuted && <span title="Muted" aria-hidden="true">⌁</span>}
                        {pinned && <span title="Pinned" aria-hidden="true">◆</span>}
                    </span>
                </span>
            </span>
        </button>
    );
}

function MessagePane({
    store,
    thread,
    history,
}: {
    store: FrontendStore;
    thread: Thread;
    history?: HistoryState;
}) {
    const messages = history?.listedIds.map(id => history.byId[id]) ?? [];
    return (
        <>
            <header className="conversation__header">
                <span className="avatar avatar--small">
                    {thread.users[0]?.picUrl ? (
                        <img src={thread.users[0].picUrl} alt="" width="40" height="40" />
                    ) : (
                        <span>{initials(thread.title)}</span>
                    )}
                </span>
                <div>
                    <h2>{thread.title}</h2>
                    <p>{thread.isGroup ? `${thread.users.length} members` : 'Instagram'}</p>
                </div>
            </header>
            <div className="messages">
                {(!history || history.status === 'loading') && (
                    <ListState label="Loading recent messages…" spinner />
                )}
                {history?.status === 'error' && (
                    <ListState
                        label={history.error ?? 'Could not load messages'}
                        error
                        actionLabel="Retry"
                        onAction={() => store.retryHistory(thread.key)}
                    />
                )}
                {history?.status === 'ready' && messages.length === 0 && (
                    <ListState label="No messages in this conversation" />
                )}
                {messages.map(message => (
                    <MessageBubble
                        key={message.id}
                        message={message}
                        outgoing={'senderId' in message && message.senderId === history?.viewerId}
                    />
                ))}
            </div>
        </>
    );
}

function MessageBubble({ message, outgoing }: { message: Message; outgoing: boolean }) {
    return (
        <div className={`message${outgoing ? ' message--outgoing' : ''}`}>
            <div className="message__bubble">
                <span>{messageSummary(message)}</span>
                <time dateTime={new Date(message.ts).toISOString()}>
                    {formatMessageTime(message.ts)}
                </time>
            </div>
        </div>
    );
}

function ListState({
    label,
    spinner,
    error,
    actionLabel,
    onAction,
}: {
    label: string;
    spinner?: boolean;
    error?: boolean;
    actionLabel?: string;
    onAction?: () => void;
}) {
    return (
        <div
            className={`list-state${error ? ' list-state--error' : ''}`}
            role={error ? 'alert' : spinner ? 'status' : undefined}
        >
            {spinner && <span className="spinner" aria-hidden="true" />}
            <span>{label}</span>
            {actionLabel && onAction && (
                <button type="button" onClick={onAction}>{actionLabel}</button>
            )}
        </div>
    );
}

function useStore(store: FrontendStore) {
    const [, setVersion] = useState(0);
    useEffect(() => {
        const unsubscribe = store.subscribe(() => setVersion(value => value + 1));
        store.start();
        return () => {
            unsubscribe();
            store.destroy();
        };
    }, [store]);
}

function messageSummary(message: Message) {
    switch (message.kind) {
        case 'text': return message.text;
        case 'reaction_log': return message.fragment;
        case 'reel_share': return message.caption || `Reel from ${message.author}`;
        case 'inline_share': return message.title;
        case 'unsupported': return `Unsupported message (${message.contentType})`;
    }
}

function initials(title: string) {
    return title.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function formatThreadTime(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMessageTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
