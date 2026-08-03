export const HISTORY_SLICE_SIZE = 40;
export const MAX_HISTORY_ROWS = 80;

export function initialHistoryWindow(listedIds: string[]) {
    return listedIds.slice(-HISTORY_SLICE_SIZE);
}

export function moveHistoryWindowOlder(listedIds: string[], viewportIds: string[]) {
    if (!viewportIds.length) return initialHistoryWindow(listedIds);
    const currentStart = listedIds.indexOf(viewportIds[0]);
    if (currentStart <= 0) return viewportIds;
    const start = Math.max(0, currentStart - HISTORY_SLICE_SIZE);
    return listedIds.slice(start, Math.min(listedIds.length, start + MAX_HISTORY_ROWS));
}

export function hasLocalOlderIds(listedIds: string[], viewportIds: string[]) {
    return Boolean(viewportIds.length && listedIds.indexOf(viewportIds[0]) > 0);
}
