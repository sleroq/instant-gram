import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { ConversationPane } from './ConversationPane';
import { createInboxClient } from './client';
import { InboxList } from './InboxList';
import { createRouteController } from './route';
import { Sidebar } from './Sidebar';
import type { HistoryAnchor } from './history-window';
import type { ListAnchor } from './virtual-list';

export default function App() {
    const client = createInboxClient();
    const route = createRouteController();
    const [compact, setCompact] = createSignal(window.innerWidth < 700);
    let listAnchor: ListAnchor | undefined;
    const anchors: Record<string, HistoryAnchor | undefined> = {};
    let lastAuthorizedAccountId: string | null = null;

    const onResize = () => setCompact(window.innerWidth < 700);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    createEffect(
        () => route.route().threadId,
        (threadId) => client.select(threadId),
    );
    createEffect(
        () => client.state.accountId,
        (accountId) => {
            if (
                accountId &&
                lastAuthorizedAccountId &&
                accountId !== lastAuthorizedAccountId
            ) {
                route.inbox();
                listAnchor = undefined;
                for (const id of Object.keys(anchors)) delete anchors[id];
            }
            if (accountId) lastAuthorizedAccountId = accountId;
        },
    );

    const inbox = () => client.state.inbox;
    const facts = () => client.state.entities;
    const selected = () => route.route().threadId;

    const list = () => (
        <InboxList
            facts={facts()}
            resource={inbox()}
            selectedId={selected()}
            restore={listAnchor}
            onPosition={(anchor) => {
                listAnchor = anchor;
            }}
            onSelect={(id) => route.open(id)}
            onRefresh={client.refresh}
            onLoadMore={client.loadMoreInbox}
        />
    );

    const conversation = (threadId: string) => (
        <ConversationPane
            threadId={threadId}
            facts={facts()}
            history={client.state.histories[threadId]}
            compact={compact()}
            savedAnchor={anchors[threadId]}
            saveAnchor={(anchor) => {
                anchors[threadId] = anchor;
            }}
            onBack={route.inbox}
            onRefresh={() => client.refreshHistory(threadId)}
            onLoadOlder={() => client.loadOlderHistory(threadId)}
        />
    );

    return (
        <main class="solid-app">
            <Show
                when={compact()}
                fallback={
                    <Sidebar
                        inbox={list()}
                        conversation={
                            <Show when={selected()}>
                                {(id) => conversation(id())}
                            </Show>
                        }
                    />
                }
            >
                <Show when={selected()} fallback={list()}>
                    {(id) => conversation(id())}
                </Show>
            </Show>
        </main>
    );
}
