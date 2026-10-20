import { createMemo, createSignal, onCleanup } from 'solid-js';
import browser from 'webextension-polyfill';

export type MotionPreference = 'system' | 'reduced' | 'full';
export const MOTION_KEY = 'motion';

function validateMotion(value: unknown): MotionPreference {
    return value === 'reduced' || value === 'full' ? value : 'system';
}

/** Small global presentation preferences, never account or worker policy. */
export function createPreferences() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const [motion, setMotion] = createSignal<MotionPreference>('system');
    const [osReduced, setOsReduced] = createSignal(media.matches);
    const [ready, setReady] = createSignal(false);
    const [error, setError] = createSignal('');
    const [pendingWrites, setPendingWrites] = createSignal(0);
    const reduced = createMemo(() =>
        motion() === 'system' ? osReduced() : motion() === 'reduced',
    );
    let disposed = false;
    let changedDuringRead = false;
    function onSystem(event: MediaQueryListEvent) {
        setOsReduced(event.matches);
    }
    function onStorage(
        changes: Record<string, browser.Storage.StorageChange>,
        area: string,
    ) {
        if (area !== 'local' || !(MOTION_KEY in changes)) return;
        changedDuringRead = true;
        setMotion(validateMotion(changes[MOTION_KEY].newValue));
    }
    media.addEventListener('change', onSystem);
    browser.storage.onChanged.addListener(onStorage);
    void browser.storage.local.get(MOTION_KEY).then(
        (stored) => {
            if (disposed) return;
            if (!changedDuringRead)
                setMotion(validateMotion(stored[MOTION_KEY]));
            setReady(true);
        },
        () => {
            if (disposed) return;
            setError('Could not load your motion preference. Using System.');
            setReady(true);
        },
    );
    onCleanup(() => {
        disposed = true;
        media.removeEventListener('change', onSystem);
        browser.storage.onChanged.removeListener(onStorage);
    });

    return {
        motion,
        reduced,
        ready,
        error,
        saving: () => pendingWrites() > 0,
        async chooseMotion(value: MotionPreference) {
            setPendingWrites((count) => count + 1);
            setError('');
            try {
                await browser.storage.local.set({ [MOTION_KEY]: value });
            } catch {
                if (!disposed)
                    setError(
                        'Could not save your motion preference. Try again.',
                    );
            } finally {
                if (!disposed) setPendingWrites((count) => count - 1);
            }
        },
    };
}

export type Preferences = ReturnType<typeof createPreferences>;
