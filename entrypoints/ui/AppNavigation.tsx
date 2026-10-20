import { createEffect } from 'solid-js';
import type { AppTab } from './route';

export function AppNavigation(props: {
    active: AppTab;
    onSelect(tab: AppTab): void;
}) {
    let chats: HTMLButtonElement | undefined;
    let settings: HTMLButtonElement | undefined;

    function focus(tab: AppTab) {
        (tab === 'chats' ? chats : settings)?.focus({ preventScroll: true });
    }
    function keydown(event: KeyboardEvent) {
        let next: AppTab;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
            next = props.active === 'chats' ? 'settings' : 'chats';
        else if (event.key === 'Home') next = 'chats';
        else if (event.key === 'End') next = 'settings';
        else return;
        event.preventDefault();
        props.onSelect(next);
        focus(next);
    }
    createEffect(
        () => props.active,
        (active, previous) => {
            if (previous && previous !== active) focus(active);
        },
    );

    return (
        <div
            class="solid-app-nav"
            role="tablist"
            aria-label="Application"
            aria-orientation="vertical"
            onKeyDown={keydown}
        >
            <button
                type="button"
                role="tab"
                id="chats-tab"
                aria-label="Chats"
                title="Chats"
                aria-controls="chats-panel"
                aria-selected={props.active === 'chats' ? 'true' : 'false'}
                tabindex={props.active === 'chats' ? 0 : -1}
                ref={(element) => (chats = element)}
                onClick={() => props.onSelect('chats')}
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
                </svg>
            </button>
            <button
                type="button"
                role="tab"
                id="settings-tab"
                aria-label="Settings"
                title="Settings"
                aria-controls="settings-panel"
                aria-selected={props.active === 'settings' ? 'true' : 'false'}
                tabindex={props.active === 'settings' ? 0 : -1}
                ref={(element) => (settings = element)}
                onClick={() => props.onSelect('settings')}
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <path d="m9.5 3-.5 2-2 1-2-.5-2.5 4.3L4 11v2l-1.5 1.2L5 18.5l2-.5 2 1 .5 2h5l.5-2 2-1 2 .5 2.5-4.3L20 13v-2l1.5-1.2L19 5.5l-2 .5-2-1-.5-2z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>
        </div>
    );
}
