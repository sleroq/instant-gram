export const REEL_VOLUME_STORAGE_KEY = 'icr:reel-volume';

export type ReelVolumePreference = {
    volume: number;
    muted: boolean;
};

export const DEFAULT_REEL_VOLUME: ReelVolumePreference = { volume: 1, muted: false };

type ReelVolumeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ReelVolumeStorageProvider = () => ReelVolumeStorage;

export function parseReelVolumePreference(value: string | null): ReelVolumePreference | undefined {
    if (!value) return undefined;
    try {
        const parsed = JSON.parse(value) as Partial<ReelVolumePreference>;
        if (
            typeof parsed.volume !== 'number' || !Number.isFinite(parsed.volume) ||
            parsed.volume < 0 || parsed.volume > 1 || typeof parsed.muted !== 'boolean'
        ) return undefined;
        return { volume: parsed.volume, muted: parsed.muted };
    } catch {
        return undefined;
    }
}

export function readReelVolumePreference(
    getStorage: ReelVolumeStorageProvider = () => window.localStorage,
): ReelVolumePreference {
    try {
        return parseReelVolumePreference(getStorage().getItem(REEL_VOLUME_STORAGE_KEY)) ?? DEFAULT_REEL_VOLUME;
    } catch {
        return DEFAULT_REEL_VOLUME;
    }
}

export function writeReelVolumePreference(
    preference: ReelVolumePreference,
    getStorage: ReelVolumeStorageProvider = () => window.localStorage,
): void {
    try {
        getStorage().setItem(REEL_VOLUME_STORAGE_KEY, JSON.stringify(preference));
    } catch {
        // Preferences are best-effort; storage policy must not block playback.
    }
}
