import browser from 'webextension-polyfill';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { startAuthProbeListener } from '../lib/ig-auth';
import { fetchInbox } from '../lib/instagram-api/inbox';
import { registerInboxProvider } from '../lib/provider/inbox-content';

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    main() {
        startAuthProbeListener();
        registerInboxProvider(browser.runtime, fetchInbox);
    },
});
