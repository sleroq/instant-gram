import { createElement } from '../../vendor/teact/src/teact/teact';
import TeactDOM from '../../vendor/teact/src/teact/teact-dom';
import App from './App';
import { uiRpc } from './rpc';
import { createFrontendStore } from './store';
import './styles.scss';

const root = document.getElementById('app');
if (!root) throw new Error('UI root was not found');

const store = createFrontendStore(uiRpc);
TeactDOM.render(createElement(App, { store }) as never, root);
