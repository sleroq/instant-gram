import { defineBackground } from 'wxt/utils/define-background';
import browser from 'webextension-polyfill';
import { prepareInboxClientPort } from '../lib/engine/ports';
import { INBOX_CLIENT_PORT } from '../lib/engine/protocol';
import { PROVIDER_PORT } from '../lib/provider/protocol';
import { acceptProvider, runWorker, withEngine } from '../lib/worker/runtime';

export default defineBackground(() => {
    browser.runtime.onConnect.addListener((port) => {
        if (port.name === PROVIDER_PORT) {
            runWorker(
                acceptProvider({
                    name: port.name,
                    sender: port.sender,
                    onMessage: {
                        addListener(listener) {
                            port.onMessage.addListener((message) => {
                                // SAFETY: WebExtension Port messages cross the structured-clone JSON protocol.
                                listener(
                                    message as import('../lib/json').JsonValue,
                                );
                            });
                        },
                    },
                    onDisconnect: {
                        addListener: (listener) =>
                            port.onDisconnect.addListener(listener),
                    },
                    postMessage: (message) => port.postMessage(message),
                    disconnect: () => port.disconnect(),
                }),
            );
        } else if (port.name === INBOX_CLIENT_PORT) {
            const activate = prepareInboxClientPort(port);
            runWorker(withEngine(activate));
        }
    });
    browser.action.onClicked.addListener(() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });
});
