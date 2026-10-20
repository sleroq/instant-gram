import { render } from '@solidjs/web';
import browser from 'webextension-polyfill';
import { createMotionPreferences } from '../../lib/preferences/motion';
import App from './App';
import './styles.scss';

const motion = createMotionPreferences(
    browser.storage,
    window.matchMedia('(prefers-reduced-motion: reduce)'),
);
// No animated surface mounts until both the stored override and OS mode are known.
await motion.ready;
const applyMotion = () => {
    document.documentElement.dataset.motion = motion.effective();
};
applyMotion();
const unsubscribe = motion.subscribe(applyMotion);
const dispose = render(
    () => <App motion={motion} />,
    document.getElementById('app')!,
);
window.addEventListener(
    'pagehide',
    () => {
        dispose();
        unsubscribe();
        motion.dispose();
    },
    { once: true },
);
