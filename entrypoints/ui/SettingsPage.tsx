import { Show } from 'solid-js';
import type { Preferences } from './preferences';

export function SettingsPage(props: { preferences: Preferences }) {
    return (
        <section class="solid-settings" aria-labelledby="settings-title">
            <h1 id="settings-title">Settings</h1>
            <div
                class="solid-settings__preference"
                aria-busy={props.preferences.saving() ? 'true' : 'false'}
            >
                <h2 id="animations-label">Animations</h2>
                <button
                    class="solid-settings__toggle"
                    type="button"
                    role="switch"
                    aria-labelledby="animations-label"
                    aria-checked={
                        props.preferences.animationsEnabled() ? 'true' : 'false'
                    }
                    onClick={() =>
                        void props.preferences.chooseAnimations(
                            !props.preferences.animationsEnabled(),
                        )
                    }
                >
                    <span class="solid-settings__switch" aria-hidden="true" />
                    <span aria-hidden="true">
                        {props.preferences.animationsEnabled() ? 'On' : 'Off'}
                    </span>
                </button>
            </div>
            <Show when={props.preferences.saving()}>
                <p class="solid-settings__status" role="status">
                    Saving…
                </p>
            </Show>
            <Show when={props.preferences.error()}>
                <p class="solid-settings__error" role="alert">
                    {props.preferences.error()}
                </p>
            </Show>
        </section>
    );
}
