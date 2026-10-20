// Dev-only browser lifecycle; never imported by the extension runtime.
export async function openDevUi(endpoint: string, url: string) {
    const pages: Array<{ id: string; type: string; url: string }> = await fetch(
        `${endpoint}/json/list`,
    ).then((response) => response.json());
    const page = pages.find(
        (page) => page.type === 'page' && page.url.split('#')[0] === url,
    );
    if (!page) {
        // Playwright's bundled WebSocket transport cannot attach in Bun.
        const response = await fetch(`${endpoint}/json/new?${url}`, {
            method: 'PUT',
        });
        if (!response.ok)
            throw new Error(`Cannot open dev UI: ${response.status}`);
    }
    // Only close launcher/new-tab placeholders after a Messages tab exists.
    for (const page of pages) {
        if (
            page.type === 'page' &&
            (page.url === 'about:blank' || page.url === 'chrome://newtab/')
        ) {
            const response = await fetch(`${endpoint}/json/close/${page.id}`);
            if (!response.ok)
                throw new Error(
                    `Cannot close blank dev tab: ${response.status}`,
                );
        }
    }
}
