import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'wxt';

export default defineConfig({
    vite: () => ({
        plugins: [solid({ include: [/entrypoints\/ui\/.*\.[jt]sx$/] })],
    }),
    manifest: {
        permissions: ['tabs'],
        host_permissions: ['https://www.instagram.com/*'],
        action: { default_title: 'Instagram DM Client' },
    },
});
