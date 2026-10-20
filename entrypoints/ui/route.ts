import { createSignal, onCleanup } from 'solid-js';

export type Route = { threadId?: string; settings?: true };

function readRoute(): Route {
    const hash = window.location.hash;
    if (hash === '#/settings') return { settings: true };
    if (!hash || hash === '#/' || hash === '#') return {};
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
    const [route, setRoute] = createSignal<Route>(readRoute());

    function update() {
        setRoute(readRoute());
    }
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    onCleanup(() => {
        window.removeEventListener('hashchange', update);
        window.removeEventListener('popstate', update);
    });

    return {
        route,
        open(threadId: string) {
            if (route().threadId === threadId) return;
            setRoute({ threadId });
            window.location.hash = threadHash(threadId);
        },
        inbox() {
            if (!route().threadId && !route().settings) return;
            setRoute({});
            window.location.hash = '#/';
        },
        settings(focus: string) {
            if (route().settings) return;
            window.history.pushState(
                {
                    settingsFromMessages: true,
                    settingsFocus: focus,
                },
                '',
                '#/settings',
            );
            update();
        },
        settingsFocus(): string | undefined {
            const focus = window.history.state?.settingsFocus;
            return focus === 'inbox' || focus === 'conversation'
                ? focus
                : undefined;
        },
        backFromSettings() {
            if (window.history.state?.settingsFromMessages === true) {
                window.history.back();
            } else {
                window.history.replaceState(null, '', '#/');
                update();
            }
        },
    };
}
