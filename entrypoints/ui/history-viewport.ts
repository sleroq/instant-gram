import {
    captureHistoryAnchor,
    correctionForAnchor,
    type HistoryAnchor,
} from './history-window';

export function createHistoryViewportController(onResize: () => void) {
    let viewport: HTMLDivElement | undefined;
    let observer: ResizeObserver | undefined;
    let mutations: MutationObserver | undefined;

    function observeRows() {
        if (!viewport || !observer) return;
        observer.disconnect();
        observer.observe(viewport);
        for (const row of viewport.querySelectorAll<HTMLElement>(
            '[data-message-id]',
        )) {
            observer.observe(row);
            for (const image of row.querySelectorAll('img'))
                observer.observe(image);
        }
    }

    function attach(element: HTMLDivElement) {
        observer?.disconnect();
        mutations?.disconnect();
        viewport = element;
        observer = new ResizeObserver(onResize);
        mutations = new MutationObserver(observeRows);
        mutations.observe(element, { childList: true, subtree: true });
        observeRows();
    }

    function capture(id?: string): HistoryAnchor | undefined {
        if (!viewport?.isConnected) return undefined;
        const boundary = viewport.getBoundingClientRect().top;
        const row = [
            ...viewport.querySelectorAll<HTMLElement>('[data-message-id]'),
        ]
            .map((item) => ({ item, rect: item.getBoundingClientRect() }))
            .find(({ rect }) => rect.bottom > boundary);
        if (!row) return undefined;
        const anchor = captureHistoryAnchor(
            viewport,
            row.item,
            id || row.item.dataset.messageId!,
        );
        return anchor;
    }

    function correct(anchor: HistoryAnchor) {
        if (!viewport?.isConnected) return false;
        const row = [
            ...viewport.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((item) => item.dataset.messageId === anchor.id);
        if (!row) return false;
        viewport.scrollTop = correctionForAnchor(viewport, row, anchor);
        return true;
    }

    function dispose() {
        mutations?.disconnect();
        observer?.disconnect();
        mutations = undefined;
        observer = undefined;
        viewport = undefined;
    }

    return {
        attach,
        capture,
        correct,
        element: () => (viewport?.isConnected ? viewport : undefined),
        dispose,
    };
}
