import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'wxt';

const chromiumProfile = fileURLToPath(
    new URL('./.dev/chromium-profile/', import.meta.url),
);
mkdirSync(chromiumProfile, { recursive: true });

// Public key only: fixes the development addon ID for the browser startup URL.
const devKey =
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAszH5B4lBSNNnllSCEMSMs0OMkunW0ygrq3dxzGWQRLqWa2H8DS4/0n3H9LzWavbKC8VYH07o/D08qvnQAs6uV9+ke9IEcgSh3Zcxx7S0zLAU3P65wgxDB19TYAdee+PIE0FehM5V786WjD0tqy4mW9HD6EifP16muo/lo98BBwSjmByhBiD5wezdWugwe6ZC+vl4CoTp8MTxA1Yw5jXwVYC30EjSupQQ57bVAZR2UxlNylBhVgqIwfMHh+4X36l7e4ql35c+F//SdBcBcaQkil+Sghg9Ns+4X6hLo2MRYULeJzCu04o6W3YgGBB60o5LYAL+LSCOFLn0vxlRVqxbdwIDAQAB';
const devId = createHash('sha256')
    .update(Buffer.from(devKey, 'base64'))
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) =>
        String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(digit, 16)),
    );

export default defineConfig({
    webExt: {
        chromiumProfile,
        keepProfileChanges: true,
    },
    hooks: {
        async 'server:created'(wxt, server) {
            if (wxt.config.browser === 'firefox') return;
            const listener = createServer();
            await new Promise<void>((resolve, reject) => {
                listener.once('error', reject);
                listener.listen(0, '127.0.0.1', resolve);
            });
            const address = listener.address();
            if (!address || typeof address === 'string')
                throw new Error(
                    'Could not allocate the dev browser debugging port',
                );
            const port = address.port;
            await new Promise<void>((resolve, reject) =>
                listener.close((error) => (error ? reject(error) : resolve())),
            );
            const config = wxt.config.runnerConfig.config;
            if (config.disabled) return;
            config.chromiumArgs = [
                ...(config.chromiumArgs ?? []),
                `--remote-debugging-port=${port}`,
            ];
            const openUi = async () => {
                const browser = await chromium.connectOverCDP(
                    `http://127.0.0.1:${port}`,
                );
                try {
                    const context = browser.contexts()[0];
                    const url = `chrome-extension://${devId}/ui.html`;
                    const pages = context.pages();
                    const page =
                        pages.find((page) => page.url() === url) ??
                        pages.find((page) => page.url() === 'about:blank') ??
                        (await context.newPage());
                    if (page.url() !== url) await page.goto(url);
                    await page.bringToFront();
                } finally {
                    await browser.close();
                }
            };
            const start = server.start.bind(server);
            server.start = async () => {
                await start();
                await openUi();
            };
            const restart = server.restartBrowser.bind(server);
            server.restartBrowser = async () => {
                await restart();
                await openUi();
            };
        },
    },
    vite: () => ({
        plugins: [solid({ include: [/entrypoints\/ui\/.*\.[jt]sx$/] })],
    }),
    manifest: ({ command }) => ({
        ...(command === 'serve' ? { key: devKey } : {}),
        permissions: ['tabs'],
        host_permissions: ['https://www.instagram.com/*'],
        action: { default_title: 'Instagram DM Client' },
    }),
});
