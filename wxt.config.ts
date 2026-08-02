import { defineConfig } from 'wxt';

export default defineConfig({
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
