const ROW_HEIGHT = 72;
const WINDOW_ROWS = 25;
const OVERSCAN = 3;

export type ListAnchor = {
    id?: string;
    offset: number;
    focusId?: string;
};

export function computeChatWindow(scrollTop: number, itemCount: number) {
    const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
    const windowSize = WINDOW_ROWS + OVERSCAN * 2;
    const start = Math.min(
        Math.max(0, firstVisible - OVERSCAN),
        Math.max(0, itemCount - windowSize),
    );
    return {
        start,
        end: Math.min(itemCount, start + windowSize),
    };
}
