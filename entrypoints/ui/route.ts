import { createSignal, onCleanup } from 'solid-js';

export type Route = { threadId?: string; settings?: true };

function readRoute(): Route {
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#') return {};
    if (hash === '#/settings') return { settings: true };
    const match = hash.match(/^#\/thread\/(.+)$/);
    try {
        return match ? { threadId: decodeURIComponent(match[1]) } : {};
    } catch {
        return {};
    }
}

export function threadHash(threadId: string): string {
    return `#/thread/${encodeURIComponent(threadId)}`;
}

export function createRouteController() {
    const initial = readRoute();
    const [route, setRoute] = createSignal<Route>(initial);
    const [messages, setMessages] = createSignal<Route>(
        initial.settings ? {} : initial,
    );

    const [returningFromSettings, setReturningFromSettings] =
        createSignal(false);

    function apply(next: Route) {
        const current = route();
        if (
            next.settings === current.settings &&
            next.threadId === current.threadId
        )
            return;
        setReturningFromSettings(Boolean(current.settings && !next.settings));
        if (!next.settings && messages().threadId !== next.threadId)
            setMessages(next);
        setRoute(next);
    }
    function update() {
        apply(readRoute());
    }
    function navigate(next: Route, hash: string) {
        apply(next);
        window.location.hash = hash;
    }
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    onCleanup(() => {
        window.removeEventListener('hashchange', update);
        window.removeEventListener('popstate', update);
    });

    return {
        route,
        messages,
        returningFromSettings,
        messagesHash: () => {
            const id = messages().threadId;
            return id ? threadHash(id) : '#/';
        },
        open(threadId: string) {
            if (route().threadId === threadId) return;
            navigate({ threadId }, threadHash(threadId));
        },
        inbox() {
            if (!route().threadId && !route().settings) return;
            navigate({}, '#/');
        },
    };
}
