import { createMemo, createSignal, onCleanup } from 'solid-js';
import browser from 'webextension-polyfill';

const MOTION_KEY = 'motion';

function parseAnimations(value: unknown): boolean | undefined {
    // Preserve saved choices from the former three-option control.
    if (value === true || value === 'full') return true;
    if (value === false || value === 'reduced') return false;
    return undefined;
}

/** Small global presentation preferences, never account or worker policy. */
export function createPreferences() {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const [savedAnimations, setSavedAnimations] = createSignal<boolean>();
    const [osReduced, setOsReduced] = createSignal(media.matches);
    const [ready, setReady] = createSignal(false);
    const [error, setError] = createSignal('');
    const [pendingWrites, setPendingWrites] = createSignal(0);
    const animationsEnabled = createMemo(
        () => savedAnimations() ?? !osReduced(),
    );
    let disposed = false;
    let storageRevision = 0;
    function onSystem(event: MediaQueryListEvent) {
        setOsReduced(event.matches);
    }
    function onStorage(
        changes: Record<string, browser.Storage.StorageChange>,
        area: string,
    ) {
        if (area !== 'local' || !(MOTION_KEY in changes)) return;
        storageRevision++;
        setSavedAnimations(parseAnimations(changes[MOTION_KEY].newValue));
    }
    media.addEventListener('change', onSystem);
    browser.storage.onChanged.addListener(onStorage);
    void browser.storage.local.get(MOTION_KEY).then(
        (stored) => {
            if (disposed) return;
            if (storageRevision === 0)
                setSavedAnimations(parseAnimations(stored[MOTION_KEY]));
            setReady(true);
        },
        () => {
            if (disposed) return;
            setError(
                'Could not load your animation preference. Using your device’s setting.',
            );
            setReady(true);
        },
    );
    onCleanup(() => {
        disposed = true;
        media.removeEventListener('change', onSystem);
        browser.storage.onChanged.removeListener(onStorage);
    });

    return {
        animationsEnabled,
        ready,
        error,
        saving: () => pendingWrites() > 0,
        async chooseAnimations(enabled: boolean) {
            const revision = storageRevision;
            setPendingWrites((count) => count + 1);
            setError('');
            try {
                await browser.storage.local.set({ [MOTION_KEY]: enabled });
                // Unchanged writes need no event; newer events remain authoritative.
                if (!disposed && storageRevision === revision)
                    setSavedAnimations(enabled);
            } catch {
                if (!disposed)
                    setError(
                        'Could not save your animation preference. Try again.',
                    );
            } finally {
                if (!disposed) setPendingWrites((count) => count - 1);
            }
        },
    };
}

export type Preferences = ReturnType<typeof createPreferences>;
