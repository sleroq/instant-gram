import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://www.instagram.com/*', '*://*.cdninstagram.com/*'],
    action: { default_title: 'Instagram DM Client' },
  },
});
