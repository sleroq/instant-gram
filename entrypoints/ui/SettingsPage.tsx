import { createSignal, For, onSettled, Show } from 'solid-js';
import type { MotionPreference } from '../../lib/preferences/motion';

const options: { value: MotionPreference; label: string; detail: string }[] = [
    {
        value: 'system',
        label: 'System',
        detail: 'Follow your device’s motion preference.',
    },
    {
        value: 'reduced',
        label: 'Reduced',
        detail: 'Turn off decorative animations.',
    },
    {
        value: 'full',
        label: 'Full',
        detail: 'Allow animations, even when your device reduces motion.',
    },
];

export function SettingsPage(props: {
    preference: MotionPreference;
    effective: 'reduced' | 'full';
    error: string;
    onChange(value: MotionPreference): Promise<void>;
    onBack(): void;
}) {
    const [pending, setPending] = createSignal(0);
    let heading: HTMLHeadingElement | undefined;
    onSettled(() => heading?.focus({ preventScroll: true }));
    async function change(value: MotionPreference) {
        setPending((value) => value + 1);
        try {
            await props.onChange(value);
        } finally {
            setPending((value) => value - 1);
        }
    }
    return (
        <section class="solid-settings" aria-labelledby="settings-title">
            <button
                class="solid-settings__back"
                type="button"
                onClick={() => props.onBack()}
            >
                Back to Messages
            </button>
            <h1
                id="settings-title"
                tabindex={-1}
                ref={(element) => (heading = element)}
            >
                Settings
            </h1>
            <p class="solid-settings__intro">
                Preferences apply to all Instant Gram windows on this browser.
            </p>
            <fieldset
                aria-busy={pending() > 0 ? 'true' : 'false'}
                aria-describedby="motion-description"
            >
                <legend>Motion</legend>
                <p id="motion-description">
                    Choose how the interface moves. Changes save automatically.
                </p>
                <For each={options}>
                    {(option) => (
                        <label class="solid-settings__option">
                            <input
                                type="radio"
                                name="motion"
                                value={option.value}
                                checked={props.preference === option.value}
                                onChange={() => void change(option.value)}
                            />
                            <span>
                                <strong>{option.label}</strong>
                                <span>{option.detail}</span>
                            </span>
                        </label>
                    )}
                </For>
            </fieldset>
            <p role="status">
                {pending() > 0
                    ? 'Saving…'
                    : `Current motion: ${props.effective === 'reduced' ? 'Reduced' : 'Full'}.`}
            </p>
            <Show when={props.error}>
                <p role="alert">{props.error}</p>
            </Show>
        </section>
    );
}
