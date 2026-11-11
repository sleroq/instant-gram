import { sizeSenderAvatarRuns } from './history-avatars';
import {
    captureHistoryAnchor,
    correctionForAnchor,
    type HistoryAnchor,
} from './history-window';

export function createHistoryViewportController(onResize: () => void) {
    let viewport: HTMLDivElement | undefined;
    let bottomClearance = 0;
    let lastScrollTop = 0;

    function scrollToBottom() {
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
        lastScrollTop = viewport.scrollTop;
    }

    function scrollDirection() {
        const next = viewport?.scrollTop ?? 0;
        const direction = Math.sign(next - lastScrollTop);
        lastScrollTop = next;
        return direction;
    }

    function setBottomClearance(height: number) {
        bottomClearance = height;
        viewport?.style.setProperty('--composer-height', `${height}px`);
        onResize();
    }
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
        lastScrollTop = element.scrollTop;
        element.style.setProperty('--composer-height', `${bottomClearance}px`);
        observer = new ResizeObserver(() => {
            onResize();
            sizeSenderAvatarRuns(element);
        });
        mutations = new MutationObserver(observeRows);
        mutations.observe(element, { childList: true, subtree: true });
        observeRows();
    }

    function capture(): HistoryAnchor | undefined {
        if (!viewport?.isConnected) return undefined;
        const boundary = viewport.getBoundingClientRect().top;
        const row = [
            ...viewport.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((item) => item.getBoundingClientRect().bottom > boundary);
        if (!row) return undefined;
        return captureHistoryAnchor(viewport, row, row.dataset.messageId!);
    }

    function correct(anchor: HistoryAnchor) {
        if (!viewport?.isConnected) return;
        const row = [
            ...viewport.querySelectorAll<HTMLElement>('[data-message-id]'),
        ].find((item) => item.dataset.messageId === anchor.id);
        if (!row) return;
        viewport.scrollTop = correctionForAnchor(viewport, row, anchor);
        lastScrollTop = viewport.scrollTop;
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
        setBottomClearance,
        capture,
        correct,
        scrollToBottom,
        scrollDirection,
        element: () => (viewport?.isConnected ? viewport : undefined),
        dispose,
    };
}
