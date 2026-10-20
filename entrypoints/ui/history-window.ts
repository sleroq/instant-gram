export const HISTORY_SLICE = 40;
export const HISTORY_MOUNT_LIMIT = 80;

export type HistoryWindow = { start: number; end: number };
export type HistoryAnchor = {
    id: string;
    offset: number;
    /** Preserve bottom intent across remounts only while this same tail remains current. */
    bottomId?: string;
};

export function initialHistoryWindow(count: number): HistoryWindow {
    const end = count;
    return {
        start: Math.max(0, end - HISTORY_SLICE),
        end,
    };
}

export function windowContaining(count: number, index: number): HistoryWindow {
    const start = Math.max(
        0,
        Math.min(
            index - HISTORY_SLICE,
            Math.max(0, count - HISTORY_MOUNT_LIMIT),
        ),
    );
    return { start, end: Math.min(count, start + HISTORY_MOUNT_LIMIT) };
}

export function moveOlder(window: HistoryWindow): HistoryWindow {
    if (window.start === 0) return window;
    return {
        start: Math.max(0, window.start - HISTORY_SLICE),
        end: Math.min(
            window.end,
            Math.max(window.start - HISTORY_SLICE, 0) + HISTORY_MOUNT_LIMIT,
        ),
    };
}

export function moveNewer(window: HistoryWindow, count: number): HistoryWindow {
    if (window.end >= count) return window;
    const end = Math.min(count, window.end + HISTORY_SLICE);
    return { start: Math.max(0, end - HISTORY_MOUNT_LIMIT), end };
}

export function captureHistoryAnchor(
    viewport: Pick<HTMLElement, 'scrollTop' | 'getBoundingClientRect'>,
    row: Pick<HTMLElement, 'getBoundingClientRect'>,
    id: string,
): HistoryAnchor {
    return {
        id,
        offset:
            row.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top,
    };
}

export function correctionForAnchor(
    viewport: Pick<HTMLElement, 'scrollTop' | 'getBoundingClientRect'>,
    row: Pick<HTMLElement, 'getBoundingClientRect'>,
    anchor: HistoryAnchor,
): number {
    const current =
        row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    return viewport.scrollTop + current - anchor.offset;
}
