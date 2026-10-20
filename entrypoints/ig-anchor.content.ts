import browser from 'webextension-polyfill';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createInboxReader } from '../lib/instagram-api/inbox';
import { registerInboxProvider } from '../lib/provider/inbox-content';

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    main(ctx) {
        // SAFETY: Chrome supplies the native runtime; the optional holder is owned by this initializer.
        const host = globalThis as typeof globalThis & {
            chrome: { runtime: object };
            __instantGramAnchor?: {
                runtime: object;
                signal: AbortSignal;
                dispose(): void;
            };
        };
        const runtime = host.chrome.runtime;
        const previous = host.__instantGramAnchor;
        if (previous?.runtime === runtime && !previous.signal.aborted) return;
        previous?.dispose();
        const reads = createInboxReader();
        const stopProvider = registerInboxProvider(browser.runtime, reads);
        let disposed = false;
        function dispose() {
            if (disposed) return;
            disposed = true;
            stopProvider();
            removeInvalidated();
            if (host.__instantGramAnchor?.dispose === dispose)
                delete host.__instantGramAnchor;
        }
        const removeInvalidated = ctx.onInvalidated(dispose);
        host.__instantGramAnchor = { runtime, signal: ctx.signal, dispose };
        if (ctx.signal.aborted) dispose();
    },
});
