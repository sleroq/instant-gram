import type { Runtime } from 'webextension-polyfill';
import type { JsonValue } from '../json.ts';
import type {
    InboxProviderEffects,
    ProviderPort,
    ProviderResponseInput,
} from './inbox.ts';

/** Preserve host listener identity; the provider validates response envelopes. */
export function providerPortFromBrowser(port: Runtime.Port): ProviderPort {
    const listeners = new Map<
        (message: ProviderResponseInput) => void,
        (message: unknown) => void
    >();
    return {
        name: port.name,
        sender: port.sender,
        onMessage: {
            addListener(listener) {
                function receive(message: unknown) {
                    // SAFETY: Provider Port messages use the structured-clone JSON protocol.
                    listener(message as JsonValue);
                }
                listeners.set(listener, receive);
                port.onMessage.addListener(receive);
            },
            removeListener(listener) {
                const receive = listeners.get(listener);
                if (!receive) return;
                port.onMessage.removeListener(receive);
                listeners.delete(listener);
            },
        },
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
