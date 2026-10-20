import { For, onSettled, Show } from 'solid-js';
import type { MotionPreference, Preferences } from './preferences';

const choices: { value: MotionPreference; title: string; detail: string }[] = [
    {
        value: 'system',
        title: 'System',
        detail: 'Follow your device’s reduced motion setting.',
    },
    {
        value: 'reduced',
        title: 'Reduced',
        detail: 'Keep changes immediate, without decorative motion.',
    },
    {
        value: 'full',
        title: 'Full',
        detail: 'Allow motion, even when your device requests less.',
    },
];

export function SettingsPage(props: {
    preferences: Preferences;
    messagesHash: string;
}) {
    let heading: HTMLHeadingElement | undefined;
    let controls: HTMLFieldSetElement | undefined;

    async function chooseMotion(value: MotionPreference) {
        await props.preferences.chooseMotion(value);
        // Native selection precedes persistence; restore the committed choice
        // after failure even when the reactive preference never changed.
        controls
            ?.querySelectorAll<HTMLInputElement>('input')
            .forEach((input) => {
                input.checked = input.value === props.preferences.motion();
            });
    }
    onSettled(() => heading?.focus());

    return (
        <section class="solid-settings" aria-labelledby="settings-title">
            <a class="solid-settings__back" href={props.messagesHash}>
                ← Back to Messages
            </a>
            <header>
                <p class="solid-settings__eyebrow">Make yourself comfortable</p>
                <h1
                    id="settings-title"
                    tabindex={-1}
                    ref={(element) => (heading = element)}
                >
                    Settings
                </h1>
                <p>
                    Small preferences for every Messages window on this browser.
                </p>
            </header>
            <fieldset
                ref={(element) => (controls = element)}
                aria-describedby="motion-description"
                aria-busy={props.preferences.saving() ? 'true' : 'false'}
            >
                <legend>Motion</legend>
                <p id="motion-description">
                    Choose how the interface moves. Your messages and loading
                    stay the same.
                </p>
                <div class="solid-settings__choices">
                    <For each={choices}>
                        {(choice) => (
                            <label class="solid-settings__choice">
                                <input
                                    type="radio"
                                    name="motion"
                                    value={choice.value}
                                    checked={
                                        props.preferences.motion() ===
                                        choice.value
                                    }
                                    onChange={() =>
                                        void chooseMotion(choice.value)
                                    }
                                    aria-labelledby={`motion-${choice.value}-title`}
                                    aria-describedby={`motion-${choice.value}-detail`}
                                />
                                <span>
                                    <strong id={`motion-${choice.value}-title`}>
                                        {choice.title}
                                    </strong>
                                    <span id={`motion-${choice.value}-detail`}>
                                        {choice.detail}
                                    </span>
                                </span>
                            </label>
                        )}
                    </For>
                </div>
                <p class="solid-settings__status" role="status">
                    {props.preferences.saving()
                        ? 'Saving preference…'
                        : props.preferences.reduced()
                          ? 'Reduced motion is active.'
                          : 'Full motion is active.'}
                </p>
                <Show when={props.preferences.error()}>
                    <p class="solid-settings__error" role="alert">
                        {props.preferences.error()}
                    </p>
                </Show>
            </fieldset>
            <footer>Saved on this browser · Shared across windows</footer>
        </section>
    );
}
