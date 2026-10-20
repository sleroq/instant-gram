import { createEffect, createSignal, onCleanup, onSettled } from 'solid-js';
import type { JSX } from '@solidjs/web';

const MIN_WIDTH = 280;
const MAX_WIDTH = 520;

export function Sidebar(props: {
    inbox: JSX.Element;
    conversation: JSX.Element;
    folded: boolean;
    width: number;
    onResize(width: number): void;
}) {
    const [availableWidth, setAvailableWidth] = createSignal(window.innerWidth);
    let layout!: HTMLDivElement;
    let separator: HTMLButtonElement | undefined;
    let dragging = false;
    let pointerId = 0;

    const maximum = (containerWidth = availableWidth()) =>
        Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, containerWidth - 320));
    const clamp = (value: number, containerWidth = availableWidth()) =>
        Math.max(MIN_WIDTH, Math.min(maximum(containerWidth), value));
    const move = (event: PointerEvent) => {
        if (dragging)
            props.onResize(
                clamp(event.clientX - layout.getBoundingClientRect().left),
            );
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
            props.onResize(
                clamp(props.width + (event.key === 'ArrowRight' ? 16 : -16)),
            );
        } else if (event.key === 'Home') {
            event.preventDefault();
            props.onResize(MIN_WIDTH);
        } else if (event.key === 'End') {
            event.preventDefault();
            props.onResize(maximum());
        }
    };
    const resize = () => {
        const containerWidth = layout.clientWidth;
        setAvailableWidth(containerWidth);
        props.onResize(clamp(props.width, containerWidth));
    };
    onSettled(() => {
        resize();
        window.addEventListener('resize', resize);
    });
    onCleanup(() => window.removeEventListener('resize', resize));
    onCleanup(end);
    createEffect(
        () => props.folded,
        (folded) => {
            if (folded) end();
        },
    );

    return (
        <div
            class="solid-layout"
            ref={(element) => (layout = element)}
            style={{
                '--sidebar-width': props.folded ? '88px' : `${props.width}px`,
            }}
        >
            <aside class="solid-sidebar">{props.inbox}</aside>
            <button
                class="solid-inbox__separator"
                type="button"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize conversations"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={maximum()}
                aria-valuenow={props.width}
                hidden={props.folded}
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
