import {
    createEffect,
    createSignal,
    createStore,
    onCleanup,
    Show,
    untrack,
} from 'solid-js';
import type {
    MutationIntent,
    OperationResult,
} from '../../lib/engine/operations';
import type { ThreadDraft } from './Composer';
import { ConversationPane } from './ConversationPane';
import { createInboxClient } from './client';
import { InboxList } from './InboxList';
import { createRouteController } from './route';
import { Sidebar } from './Sidebar';
import { AppNavigation } from './AppNavigation';
import { SettingsPage } from './SettingsPage';
import { createPreferences } from './preferences';
import type { HistoryAnchor } from './history-window';
import type { ListAnchor } from './virtual-list';

export default function App() {
    const preferences = createPreferences();
    const client = createInboxClient();
    createEffect(
        () => preferences.animationsEnabled(),
        (enabled) => {
            document.documentElement.dataset.motion = enabled ? 'on' : 'off';
        },
    );
    onCleanup(() => {
        delete document.documentElement.dataset.motion;
    });
    const [drafts, setDrafts] = createStore<Record<string, ThreadDraft>>({});
    const pendingDrafts = new Map<string, Promise<OperationResult>>();
    function mutateWithDraftGuard(
        intent: MutationIntent,
    ): Promise<OperationResult> {
        if (intent.type !== 'send') return client.mutate(intent);
        const generation = navigationGeneration;
        const accountId = client.state.accountId;
        const accountEpoch = client.state.accountEpoch;
        const version = drafts[intent.threadId]?.version ?? 0;
        const key = `${accountId}:${accountEpoch}:${intent.threadId}:${version}`;
        const pending = pendingDrafts.get(key);
        if (pending) return pending;
        const acceptance = client.mutate(intent);
        pendingDrafts.set(key, acceptance);
        void acceptance.then((result) =>
            untrack(() => {
                pendingDrafts.delete(key);
                if (
                    result.ok &&
                    generation === navigationGeneration &&
                    drafts[intent.threadId]?.version === version
                )
                    setDrafts((draft) => {
                        draft[intent.threadId] = {
                            text: '',
                            version: version + 1,
                        };
                    });
            }),
        );
        return acceptance;
    }
    const route = createRouteController();
    const [compact, setCompact] = createSignal(window.innerWidth < 700);
    let listAnchor: ListAnchor | undefined;
    const anchors: Record<string, HistoryAnchor | undefined> = {};
    let identity:
        | {
              accountId: string | null;
              accountEpoch: number;
              workerEpoch: string;
          }
        | undefined;
    let navigationGeneration = 0;
    const [navigationKey, setNavigationKey] = createSignal(1);
    let lastAuthorizedAccountId: string | null = null;

    const onResize = () => setCompact(window.innerWidth < 700);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    createEffect(
        () => route.chats().threadId,
        (threadId) =>
            client.select(
                threadId,
                threadId ? anchors[threadId]?.id : undefined,
            ),
    );
    createEffect(
        () => ({
            accountId: client.state.accountId,
            accountEpoch: client.state.accountEpoch,
            workerEpoch: client.state.workerEpoch,
            identityError: client.state.inbox.error?.kind,
        }),
        (next) => {
            if (!next.workerEpoch) return;
            if (
                identity &&
                lastAuthorizedAccountId !== null &&
                ((next.workerEpoch === identity.workerEpoch &&
                    identity.accountEpoch > 0 &&
                    next.accountEpoch !== identity.accountEpoch) ||
                    (next.accountId !== null &&
                        next.accountId !== lastAuthorizedAccountId) ||
                    (next.accountId === null &&
                        next.accountEpoch > 0 &&
                        next.identityError === 'auth'))
            ) {
                setDrafts((draft) => {
                    for (const id of Object.keys(draft)) delete draft[id];
                });
                pendingDrafts.clear();
                navigationGeneration++;
                setNavigationKey(navigationGeneration + 1);
                route.inbox();
                listAnchor = undefined;
                for (const id of Object.keys(anchors)) delete anchors[id];
            }
            if (next.accountId !== null)
                lastAuthorizedAccountId = next.accountId;
            identity = next;
        },
    );

    const inbox = () => client.state.inbox;
    const facts = () => client.state.entities;
    const selected = () => route.chats().threadId;

    const list = () => (
        <Show when={navigationKey()} keyed>
            {(key) => (
                <InboxList
                    facts={facts()}
                    resource={inbox()}
                    selectedId={selected()}
                    restore={listAnchor}
                    restoreFocus={!route.returningToChats()}
                    onPosition={(anchor) => {
                        if (key === navigationGeneration + 1)
                            listAnchor = anchor;
                    }}
                    onSelect={(id) => route.open(id)}
                    onRefresh={client.refresh}
                    onLoadMore={client.loadMoreInbox}
                />
            )}
        </Show>
    );

    const conversation = (threadId: string) => {
        const generation = navigationGeneration;
        return (
            <ConversationPane
                threadId={threadId}
                draft={drafts[threadId] ?? { text: '', version: 0 }}
                updateDraft={(value) =>
                    setDrafts((draft) => {
                        draft[threadId] = value;
                    })
                }
                mutate={mutateWithDraftGuard}
                operations={client.state.operations ?? []}
                onRetry={client.retryOperation}
                onRemove={client.removeOperation}
                facts={facts()}
                history={client.state.histories[threadId]}
                compact={compact()}
                savedAnchor={anchors[threadId]}
                saveAnchor={(anchor) => {
                    if (generation === navigationGeneration) {
                        anchors[threadId] = anchor;
                        client.rememberHistoryAnchor(threadId, anchor?.id);
                    }
                }}
                onBack={route.inbox}
                onRefresh={(anchorId) =>
                    client.refreshHistory(threadId, anchorId)
                }
                onLoadOlder={() => client.loadOlderHistory(threadId)}
                onLoadNewer={() => client.loadNewerHistory(threadId)}
            />
        );
    };

    return (
        <main class="solid-app">
            <Show when={preferences.ready()}>
                <div class="solid-shell">
                    <AppNavigation
                        active={route.route().tab}
                        onSelect={route.selectTab}
                    />
                    <div class="solid-shell__content">
                        <div
                            role="tabpanel"
                            id="chats-panel"
                            aria-labelledby="chats-tab"
                            tabindex={0}
                            hidden={route.route().tab !== 'chats'}
                        >
                            <Show when={route.route().tab === 'chats'}>
                                <Show
                                    when={compact()}
                                    fallback={
                                        <Sidebar
                                            inbox={list()}
                                            conversation={
                                                <Show when={selected()} keyed>
                                                    {(id) => conversation(id)}
                                                </Show>
                                            }
                                        />
                                    }
                                >
                                    <Show
                                        when={selected()}
                                        fallback={list()}
                                        keyed
                                    >
                                        {(id) => conversation(id)}
                                    </Show>
                                </Show>
                            </Show>
                        </div>
                        <div
                            role="tabpanel"
                            id="settings-panel"
                            aria-labelledby="settings-tab"
                            tabindex={0}
                            hidden={route.route().tab !== 'settings'}
                        >
                            <Show when={route.route().tab === 'settings'}>
                                <SettingsPage preferences={preferences} />
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>
        </main>
    );
}
