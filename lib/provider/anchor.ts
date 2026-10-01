import browser from 'webextension-polyfill';

export async function ensureAnchorTab(
    hasReadyConnection: (tabId: number) => boolean = () => false,
): Promise<number> {
    const tabs = await browser.tabs.query({
        url: 'https://www.instagram.com/*',
    });
    const existing = tabs.find((tab) => Number.isInteger(tab.id));
    if (existing?.id !== undefined) {
        // WXT reinjection invalidates the old context before main's singleton guard.
        if (
            !hasReadyConnection(existing.id) &&
            existing.status === 'complete' &&
            existing.url?.startsWith('https://www.instagram.com/') &&
            !existing.pendingUrl
        ) {
            await browser.scripting.executeScript({
                target: { tabId: existing.id },
                world: 'MAIN',
                files: ['content-scripts/ig-auth-probe.js'],
            });
            await browser.scripting.executeScript({
                target: { tabId: existing.id },
                world: 'ISOLATED',
                files: ['content-scripts/ig-anchor.js'],
            });
        }
        return existing.id;
    }
    const created = await browser.tabs.create({
        url: 'https://www.instagram.com/direct/inbox/',
        active: false,
    });
    if (!Number.isInteger(created.id))
        throw new Error('Could not create Instagram anchor tab');
    if (created.id === undefined)
        throw new Error('Could not create Instagram anchor tab');
    return created.id;
}
