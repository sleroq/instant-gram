import { createSignal, onCleanup } from 'solid-js';

export type AppTab = 'chats' | 'settings';
type ChatsRoute = { tab: 'chats'; threadId?: string };
export type Route = ChatsRoute | { tab: 'settings' };

function readRoute(): Route {
    const hash = window.location.hash;
    if (hash === '#/settings') return { tab: 'settings' };
    const match = hash.match(/^#\/thread\/(.+)$/);
    try {
        return match
            ? { tab: 'chats', threadId: decodeURIComponent(match[1]) }
            : { tab: 'chats' };
    } catch {
        return { tab: 'chats' };
    }
}

export function threadHash(threadId: string): string {
    return `#/thread/${encodeURIComponent(threadId)}`;
}

export function createRouteController() {
    const initial = readRoute();
    const [route, setRoute] = createSignal<Route>(initial);
    const [chats, setChats] = createSignal<ChatsRoute>(
        initial.tab === 'chats' ? initial : { tab: 'chats' },
    );
    const [returningToChats, setReturningToChats] = createSignal(false);

    function apply(next: Route) {
        const current = route();
        if (
            next.tab === current.tab &&
            (next.tab === 'settings' || next.threadId === chats().threadId)
        )
            return;
        setReturningToChats(current.tab === 'settings' && next.tab === 'chats');
        if (next.tab === 'chats' && next.threadId !== chats().threadId)
            setChats(next);
        setRoute(next);
    }
    function update() {
        apply(readRoute());
    }
    function navigate(next: Route) {
        apply(next);
        window.location.hash =
            next.tab === 'settings'
                ? '#/settings'
                : next.threadId
                  ? threadHash(next.threadId)
                  : '#/';
    }
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    onCleanup(() => {
        window.removeEventListener('hashchange', update);
        window.removeEventListener('popstate', update);
    });

    return {
        route,
        chats,
        returningToChats,
        selectTab(tab: AppTab) {
            navigate(tab === 'settings' ? { tab } : chats());
        },
        open(threadId: string) {
            navigate({ tab: 'chats', threadId });
        },
        inbox() {
            navigate({ tab: 'chats' });
        },
    };
}
