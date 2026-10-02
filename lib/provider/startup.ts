import type { Runtime } from 'webextension-polyfill';
import type { InboxProviderEffects, ProviderPort } from './inbox.ts';

/** Preserve host listener identity; the provider validates response envelopes. */
export function providerPortFromBrowser(port: Runtime.Port): ProviderPort {
    // SAFETY: This extension-owned Port transports JSON; the provider validates response envelopes.
    const onMessage = port.onMessage as ProviderPort['onMessage'];
    return {
        name: port.name,
        sender: port.sender,
        onMessage,
        onDisconnect: port.onDisconnect,
        postMessage: (message) => port.postMessage(message),
        disconnect: () => port.disconnect(),
    };
}

/** Capture disconnect before asynchronous runtime/layer initialization. */
export function prepareInboxProviderPort(port: ProviderPort) {
    let pending = true;
    function onDisconnect() {
        pending = false;
        port.onDisconnect.removeListener(onDisconnect);
    }
    function dispose() {
        if (!pending) return;
        pending = false;
        port.onDisconnect.removeListener(onDisconnect);
        port.disconnect();
    }
    function activate(provider: InboxProviderEffects) {
        if (!pending) return;
        pending = false;
        port.onDisconnect.removeListener(onDisconnect);
        provider.accept(port);
    }
    port.onDisconnect.addListener(onDisconnect);
    return Object.assign(activate, { dispose });
}
