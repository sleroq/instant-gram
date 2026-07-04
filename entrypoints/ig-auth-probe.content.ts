import { defineContentScript } from 'wxt/utils/define-content-script';
import { startMainWorldAuthProbe } from '../lib/ig-auth';

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    world: 'MAIN',
    main() {
        startMainWorldAuthProbe();
    },
});
