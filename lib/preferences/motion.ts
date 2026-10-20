export const MOTION_STORAGE_KEY = 'presentation.motion';
export type MotionPreference = 'system' | 'reduced' | 'full';
export type EffectiveMotion = 'reduced' | 'full';

export function parseMotionPreference(value: unknown): MotionPreference {
    return value === 'reduced' || value === 'full' ? value : 'system';
}

type StorageChanges = Record<string, { newValue?: unknown }>;
type ChangeListener = (changes: StorageChanges, area: string) => void;

export function createMotionPreferences(
    storage: {
        local: {
            get(
                key: typeof MOTION_STORAGE_KEY,
            ): Promise<{ [MOTION_STORAGE_KEY]?: unknown }>;
            set(values: {
                [MOTION_STORAGE_KEY]: MotionPreference;
            }): Promise<void>;
        };
        onChanged: {
            addListener(listener: ChangeListener): void;
            removeListener(listener: ChangeListener): void;
        };
    },
    media: Pick<
        MediaQueryList,
        'matches' | 'addEventListener' | 'removeEventListener'
    >,
) {
    let preference: MotionPreference = 'system';
    let persisted: MotionPreference = 'system';
    let pending = 0;
    let writes = Promise.resolve();
    let error = '';
    let revision = 0;
    let disposed = false;
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((listener) => listener());
    const changed: ChangeListener = (changes, area) => {
        if (area !== 'local' || !(MOTION_STORAGE_KEY in changes)) return;
        revision++;
        persisted = parseMotionPreference(changes[MOTION_STORAGE_KEY].newValue);
        if (!pending) preference = persisted;
        error = '';
        notify();
    };
    const osChanged = () => notify();
    storage.onChanged.addListener(changed);
    media.addEventListener('change', osChanged);
    const initialRevision = revision;
    const ready = storage.local.get(MOTION_STORAGE_KEY).then(
        (values) => {
            if (!disposed && revision === initialRevision) {
                persisted = parseMotionPreference(values[MOTION_STORAGE_KEY]);
                if (!pending) preference = persisted;
            }
        },
        () => {
            if (!disposed && revision === initialRevision)
                error = 'Could not load motion preference. Using System.';
        },
    );

    return {
        ready,
        preference: () => preference,
        effective: (): EffectiveMotion =>
            preference === 'system'
                ? media.matches
                    ? 'reduced'
                    : 'full'
                : preference,
        error: () => error,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        set(value: MotionPreference) {
            // Validate at the persistence boundary as well as when reading.
            const next = parseMotionPreference(value);
            if (disposed) return Promise.resolve();
            pending++;
            preference = next;
            error = '';
            notify();
            // Keep rapid keyboard changes ordered without disabling the focused radio.
            writes = writes.then(async () => {
                const beforeWrite = revision;
                try {
                    await storage.local.set({ [MOTION_STORAGE_KEY]: next });
                    // An event may already have delivered this or a newer value.
                    if (revision === beforeWrite) persisted = next;
                    error = '';
                } catch {
                    error = 'Could not save motion preference. Try again.';
                }
                pending--;
                if (!pending) preference = persisted;
                if (!disposed) notify();
            });
            return writes;
        },
        dispose() {
            disposed = true;
            storage.onChanged.removeListener(changed);
            media.removeEventListener('change', osChanged);
            listeners.clear();
        },
    };
}

export type MotionPreferences = ReturnType<typeof createMotionPreferences>;
