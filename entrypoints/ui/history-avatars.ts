export function sizeSenderAvatarRuns(viewport: HTMLElement) {
    const runs: {
        avatar: HTMLElement;
        first: HTMLElement;
        last: HTMLElement;
    }[] = [];
    let current: (typeof runs)[number] | undefined;
    let sender: string | undefined;

    for (const row of viewport.querySelectorAll<HTMLElement>(
        '[data-message-id]',
    )) {
        if (!row.dataset.senderId || row.dataset.senderId !== sender)
            current = undefined;
        sender = row.dataset.senderId;
        const avatar = row.querySelector<HTMLElement>(
            '.solid-message__avatar-run',
        );
        if (avatar) {
            current = { avatar, first: row, last: row };
            runs.push(current);
        } else if (current) current.last = row;
    }

    const heights = runs.map(
        ({ first, last }) =>
            last.getBoundingClientRect().bottom -
            first.getBoundingClientRect().top,
    );
    for (const [index, run] of runs.entries()) {
        run.avatar.style.setProperty(
            '--avatar-run-height',
            `${heights[index]}px`,
        );
    }
}
