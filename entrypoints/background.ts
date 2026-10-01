import { defineBackground } from 'wxt/utils/define-background';
import browser from 'webextension-polyfill';
import { prepareInboxClientPort } from '../lib/engine/ports';
import { INBOX_CLIENT_PORT } from '../lib/engine/protocol';
import { PROVIDER_PORT } from '../lib/provider/protocol';
import {
    prepareInboxProviderPort,
    providerPortFromBrowser,
} from '../lib/provider/startup';
import { acceptProvider, runWorker, withEngine } from '../lib/worker/runtime';

export default defineBackground(() => {
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === PROVIDER_PORT) {
            const activate = prepareInboxProviderPort(
                providerPortFromBrowser(port),
            );
            runWorker(acceptProvider(activate), activate.dispose);
        } else if (port.name === INBOX_CLIENT_PORT) {
            const activate = prepareInboxClientPort(port);
            runWorker(withEngine(activate));
        }
    });
    browser.action.onClicked.addListener(() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });
});
