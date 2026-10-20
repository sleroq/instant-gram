import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'wxt';
import { openDevUi, prepareDevChromiumProfile } from './lib/dev-browser';

const chromiumProfile = prepareDevChromiumProfile(
    fileURLToPath(new URL('.', import.meta.url)),
);
// Shared with opencode.json so MCP attaches to the dev browser.
const devPort = 9223;

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
        chromiumArgs: [`--remote-debugging-port=${devPort}`],
    },
    hooks: {
        async 'server:created'(wxt, server) {
            if (
                wxt.config.browser === 'firefox' ||
                wxt.config.runnerConfig.config.disabled
            )
                return;
            function openUi() {
                return openDevUi(
                    `http://127.0.0.1:${devPort}`,
                    `chrome-extension://${devId}/ui.html`,
                );
            }
            const start = server.start.bind(server);
            server.start = async () => {
                await start();
                await openUi();
                // Register after initial opening so startup cannot create two tabs.
                // This also covers runtime.reload() and browser restarts.
                server.ws.on('wxt:background-initialized', () => {
                    void openUi().catch((error) => wxt.logger.error(error));
                });
            };
        },
    },
    vite: () => ({
        plugins: [solid({ include: [/entrypoints\/ui\/.*\.[jt]sx$/] })],
    }),
    manifest: ({ command }) => ({
        name: command === 'serve' ? 'Instagram DM Client (Dev)' : undefined,
        key: command === 'serve' ? devKey : undefined,
        permissions: ['tabs', 'scripting'],
        host_permissions: ['https://www.instagram.com/*'],
        action: {
            default_title:
                command === 'serve'
                    ? 'Instagram DM Client (Dev)'
                    : 'Instagram DM Client',
        },
    }),
});
