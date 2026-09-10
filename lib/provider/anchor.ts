import browser from 'webextension-polyfill';

export async function ensureAnchorTab(): Promise<number> {
    const tabs = await browser.tabs.query({
        url: 'https://www.instagram.com/*',
    });
    const existingId = tabs
        .map((tab) => tab.id)
        .find((id) => Number.isInteger(id));
    if (existingId !== undefined) return existingId;
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
