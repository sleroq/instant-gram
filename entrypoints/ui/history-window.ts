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

export function appendToHistoryWindow(viewportIds: string[], id: string) {
    if (viewportIds.includes(id)) return viewportIds;
    return [...viewportIds, id].slice(-MAX_HISTORY_ROWS);
}

export function historyWindowAroundTarget(listedIds: string[], targetId: string) {
    const targetIndex = listedIds.indexOf(targetId);
    if (targetIndex < 0) return [];
    const start = Math.min(
        Math.max(0, targetIndex - HISTORY_SLICE_SIZE),
        Math.max(0, listedIds.length - MAX_HISTORY_ROWS),
    );
    return listedIds.slice(start, start + MAX_HISTORY_ROWS);
}
