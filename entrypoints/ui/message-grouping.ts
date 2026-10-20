import type { Message } from '../../lib/domain';

/** Presentation only; callers supply the adjacent retained message, if known. */
export function messageGrouping(
    current: Message | undefined,
    previous: Message | undefined,
) {
    const currentDate = new Date(current?.ts ?? NaN);
    const previousDate = new Date(previous?.ts ?? NaN);
    const sameDate =
        Number.isFinite(currentDate.getTime()) &&
        Number.isFinite(previousDate.getTime()) &&
        currentDate.toDateString() === previousDate.toDateString();
    const gap = current && previous ? current.ts - previous.ts : NaN;
    const grouped = Boolean(
        current &&
            previous &&
            'senderId' in current &&
            'senderId' in previous &&
            current.senderId === previous.senderId &&
            sameDate &&
            gap >= 0 &&
            gap <= 5 * 60_000,
    );
    return { startsGroup: !grouped, newDate: Boolean(current && !sameDate) };
}
