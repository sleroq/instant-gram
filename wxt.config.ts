import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    vite: () => ({
        resolve: {
            alias: {
                teact: fileURLToPath(
                    new URL('./vendor/teact/src/teact', import.meta.url),
                ),
            },
        },
    }),
    webExt: {
        binaries: {
            chrome: '/Applications/Helium.app/Contents/MacOS/Helium',
        },
    },
    manifest: {
        permissions: ['storage', 'tabs'],
        host_permissions: [
            'https://www.instagram.com/*',
            '*://*.cdninstagram.com/*',
        ],
        action: { default_title: 'Instagram DM Client' },
    },
});
