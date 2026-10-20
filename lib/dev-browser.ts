import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev-only browser lifecycle; never imported by the extension runtime.
export function prepareDevChromiumProfile(repositoryRoot: string) {
    const gitDirectory = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: repositoryRoot, encoding: 'utf8' },
    ).trim();
    // All worktrees reuse the original checkout's existing authenticated profile.
    const profile = resolve(gitDirectory, '../.dev/chromium-profile');
    mkdirSync(profile, { recursive: true });
    return profile;
}

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
