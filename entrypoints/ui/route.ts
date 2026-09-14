import { createEffect, createSignal, onCleanup } from 'solid-js';

export type Route = { threadId?: string };

function readRoute(): Route {
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#') return {};
    const match = hash.match(/^#\/thread\/(.+)$/);
    return match ? { threadId: decodeURIComponent(match[1]) } : {};
}

export function threadHash(threadId: string): string {
    return `#/thread/${encodeURIComponent(threadId)}`;
}

export function createRouteController(onInbox?: () => void) {
    const initialRoute = readRoute();
    const [route, setRoute] = createSignal<Route>(initialRoute);
    let previousThread: string | undefined = initialRoute.threadId;

    function update() {
        setRoute(readRoute());
    }
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    onCleanup(() => {
        window.removeEventListener('hashchange', update);
        window.removeEventListener('popstate', update);
    });
    createEffect(
        () => route().threadId,
        (threadId) => {
            if (previousThread && !threadId) onInbox?.();
            previousThread = threadId;
        },
    );

    return {
        route,
        open(threadId: string) {
            if (route().threadId === threadId) return;
            window.location.hash = threadHash(threadId);
        },
        inbox() {
            if (!route().threadId) return;
            window.location.hash = '#/';
        },
    };
}
