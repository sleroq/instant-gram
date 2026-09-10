import { defineBackground } from 'wxt/utils/define-background';
import browser from 'webextension-polyfill';
import { createInboxRepository } from '../lib/engine/db';
import { createInboxEngine } from '../lib/engine/inbox';
import { registerInboxClientPorts } from '../lib/engine/ports';
import { INBOX_CLIENT_PORT } from '../lib/engine/protocol';
import { ensureAnchorTab } from '../lib/provider/anchor';
import { createInboxProvider } from '../lib/provider/inbox';
import { PROVIDER_PORT } from '../lib/provider/protocol';

export default defineBackground(() => {
    const provider = createInboxProvider({
        ensureAnchor: ensureAnchorTab,
        extensionId: browser.runtime.id,
    });
    const engine = createInboxEngine(createInboxRepository(), provider);

    browser.runtime.onConnect.addListener((port) => {
        if (port.name === PROVIDER_PORT) {
            provider.accept({
                name: port.name,
                sender: port.sender,
                onMessage: {
                    addListener(listener) {
                        // SAFETY: the named provider port's content counterpart posts only ProviderResponse values.
                        port.onMessage.addListener(
                            listener as Parameters<
                                typeof port.onMessage.addListener
                            >[0],
                        );
                    },
                },
                onDisconnect: {
                    addListener: (listener) =>
                        port.onDisconnect.addListener(listener),
                },
                postMessage: (message) => port.postMessage(message),
                disconnect: () => port.disconnect(),
            });
        } else if (port.name === INBOX_CLIENT_PORT)
            registerInboxClientPorts(port, engine);
    });
    browser.action.onClicked.addListener(() => {
        void browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });
});
