import { createSignal, onCleanup, onSettled } from 'solid-js';
import type { JSX } from '@solidjs/web';

const MIN_WIDTH = 280;
const MAX_WIDTH = 520;

export function Sidebar(props: {
    inbox: JSX.Element;
    conversation: JSX.Element;
}) {
    const [width, setWidth] = createSignal(360);
    const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
    let separator: HTMLButtonElement | undefined;
    let dragging = false;
    let pointerId = 0;

    const maximum = (viewportWidth = windowWidth()) =>
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewportWidth - 320));
    const clamp = (value: number, viewportWidth = windowWidth()) =>
        Math.max(MIN_WIDTH, Math.min(maximum(viewportWidth), value));
    const move = (event: PointerEvent) => {
        if (dragging) setWidth(clamp(event.clientX));
    };
    const end = () => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (separator?.hasPointerCapture(pointerId))
            separator.releasePointerCapture(pointerId);
    };
    const start = (event: PointerEvent) => {
        dragging = true;
        pointerId = event.pointerId;
        separator?.setPointerCapture(pointerId);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    };
    const keydown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setWidth((value) =>
                clamp(value + (event.key === 'ArrowRight' ? 16 : -16)),
            );
        } else if (event.key === 'Home') {
            event.preventDefault();
            setWidth(MIN_WIDTH);
        } else if (event.key === 'End') {
            event.preventDefault();
            setWidth(maximum());
        }
    };
    const resize = () => {
        setWindowWidth(window.innerWidth);
        setWidth((value) => clamp(value, window.innerWidth));
    };
    onSettled(() => window.addEventListener('resize', resize));
    onCleanup(() => window.removeEventListener('resize', resize));
    onCleanup(end);

    return (
        <div class="solid-layout" style={{ '--sidebar-width': `${width()}px` }}>
            <aside class="solid-sidebar">{props.inbox}</aside>
            <button
                class="solid-inbox__separator"
                type="button"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize conversations"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={maximum()}
                aria-valuenow={width()}
                tabindex={0}
                ref={(element) => (separator = element)}
                onPointerDown={start}
                onKeyDown={keydown}
            />
            <section class="solid-layout__conversation">
                {props.conversation}
            </section>
        </div>
    );
}
