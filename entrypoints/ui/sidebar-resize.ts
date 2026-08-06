export const DEFAULT_SIDEBAR_WIDTH = 390;
export const MIN_SIDEBAR_WIDTH = 280;
export const MAX_SIDEBAR_WIDTH = 520;
export const MIN_CONVERSATION_WIDTH = 320;
export const SIDEBAR_RESIZE_BREAKPOINT = 640;
export const SIDEBAR_WIDTH_STORAGE_KEY = 'icr:sidebar-width';

const DESKTOP_HORIZONTAL_CHROME = 48; // 16px shell padding on both sides plus its 16px gap.

export type SidebarWidthBounds = { min: number; max: number };
type SidebarPreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SidebarPreferenceStorageProvider = () => SidebarPreferenceStorage;

export function sidebarWidthBounds(viewportWidth: number): SidebarWidthBounds {
    const availableForSidebar = Math.floor(viewportWidth - DESKTOP_HORIZONTAL_CHROME - MIN_CONVERSATION_WIDTH);
    const max = Math.max(0, Math.min(MAX_SIDEBAR_WIDTH, availableForSidebar));
    return { min: Math.min(MIN_SIDEBAR_WIDTH, max), max };
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
    const { min, max } = sidebarWidthBounds(viewportWidth);
    return Math.round(Math.min(max, Math.max(min, width)));
}

export function parseSidebarWidth(value: string | null): number | undefined {
    if (value === null || value.trim() === '') return undefined;
    const width = Number(value);
    return Number.isFinite(width) && width > 0 ? width : undefined;
}

export function readSidebarWidthPreference(
    getStorage: SidebarPreferenceStorageProvider = () => window.localStorage,
): number | undefined {
    try {
        return parseSidebarWidth(getStorage().getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    } catch {
        return undefined;
    }
}

export function writeSidebarWidthPreference(
    width: number,
    getStorage: SidebarPreferenceStorageProvider = () => window.localStorage,
): void {
    try {
        getStorage().setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    } catch {
        // Preferences are best-effort; storage policy must not block interaction.
    }
}

export function removeSidebarWidthPreference(
    getStorage: SidebarPreferenceStorageProvider = () => window.localStorage,
): void {
    try {
        getStorage().removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    } catch {
        // Preferences are best-effort; storage policy must not block interaction.
    }
}
