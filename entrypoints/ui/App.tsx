import {
    createEffect,
    createSignal,
    createStore,
    onCleanup,
    onSettled,
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
import type { HistoryAnchor } from './history-window';
import type { ListAnchor } from './virtual-list';
import type { MotionPreferences } from '../../lib/preferences/motion';
import { SettingsPage } from './SettingsPage';

export default function App(props: { motion: MotionPreferences }) {
    const [motionVersion, setMotionVersion] = createSignal(0);
    const unsubscribeMotion = untrack(() =>
        props.motion.subscribe(() => setMotionVersion((value) => value + 1)),
    );
    onCleanup(unsubscribeMotion);
    const motion = () => {
        motionVersion();
        return {
            preference: props.motion.preference(),
            effective: props.motion.effective(),
            error: props.motion.error(),
        };
    };
    const client = createInboxClient();
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
    let settingsFocus: string | undefined;
    function openSettings(event: MouseEvent) {
        const target = event.currentTarget;
        if (
            !(target instanceof HTMLAnchorElement) ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        settingsFocus = target.dataset.settingsLink;
        route.settings(settingsFocus || 'inbox');
    }
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

    function focusSettingsEntry(origin: string) {
        const target =
            document.querySelector<HTMLElement>(
                `[data-settings-link="${origin}"]`,
            ) || document.querySelector<HTMLElement>('[data-settings-link]');
        target?.focus({ preventScroll: true });
    }
    const onResize = () => {
        const focused = document.activeElement;
        const origin =
            focused instanceof HTMLElement
                ? focused.dataset.settingsLink
                : undefined;
        setCompact(window.innerWidth < 700);
        // A resize event can arrive just after Back restored the previous pane.
        if (origin) queueMicrotask(() => focusSettingsEntry(origin));
    };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    createEffect(
        () => route.route().threadId,
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
    const selected = () => route.route().threadId;

    const list = () => {
        const restoreFocus = !settingsFocus;
        return (
            <Show when={navigationKey()} keyed>
                {(key) => (
                    <InboxList
                        facts={facts()}
                        resource={inbox()}
                        selectedId={selected()}
                        restore={listAnchor}
                        restoreFocus={restoreFocus}
                        onSettings={openSettings}
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
    };

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
                onSettings={openSettings}
                onRefresh={(anchorId) =>
                    client.refreshHistory(threadId, anchorId)
                }
                onLoadOlder={() => client.loadOlderHistory(threadId)}
                onLoadNewer={() => client.loadNewerHistory(threadId)}
            />
        );
    };

    function Messages() {
        onSettled(() => {
            if (settingsFocus) {
                focusSettingsEntry(settingsFocus);
                settingsFocus = undefined;
            }
        });
        return (
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
                <Show when={selected()} fallback={list()} keyed>
                    {(id) => conversation(id)}
                </Show>
            </Show>
        );
    }

    function Settings() {
        // The history entry keeps this origin across repeated Back/Forward visits.
        settingsFocus = route.settingsFocus() || 'inbox';
        return (
            <SettingsPage
                preference={motion().preference}
                effective={motion().effective}
                error={motion().error}
                onChange={props.motion.set}
                onBack={route.backFromSettings}
            />
        );
    }

    return (
        <main class="solid-app">
            <Show when={route.route().settings} fallback={<Messages />}>
                <Settings />
            </Show>
        </main>
    );
}
