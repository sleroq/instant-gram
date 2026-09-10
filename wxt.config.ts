import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import solid from '@solidjs/vite-plugin';
import { transformWithEsbuild, type Plugin } from 'vite';

const solidPreview = process.env.WXT_SOLID_PREVIEW === '1';

const legacyTeactTransform: Plugin = {
    name: 'legacy-teact-tsx',
    enforce: 'pre',
    transform(code, id) {
        if (!/\/(entrypoints\/ui\/(?:App|main)|tests\/history-harness)\.tsx$/.test(id)) return;
        return transformWithEsbuild(code, id, {
            loader: 'tsx',
            jsx: 'automatic',
            jsxImportSource: 'teact',
        });
    },
};

export default defineConfig({
    outDir: solidPreview ? '.output-solid' : '.output',
    vite: () => ({
        plugins: [legacyTeactTransform, solid({
            include: [/entrypoints\/solid\/.*\.[jt]sx$/],
        })],
        resolve: {
            alias: {
                teact: fileURLToPath(
                    new URL('./vendor/teact/src/teact', import.meta.url),
                ),
            },
        },
    }),
    hooks: {
        'entrypoints:found': (_wxt, infos) => {
            if (!solidPreview) {
                const solidIndex = infos.findIndex(info => info.name === 'solid');
                if (solidIndex !== -1) infos.splice(solidIndex, 1);
            }
        },
    },
    manifest: {
        permissions: ['storage', 'tabs'],
        host_permissions: [
            'https://www.instagram.com/*',
            'https://*.cdninstagram.com/*',
        ],
        action: { default_title: 'Instagram DM Client' },
    },
});
