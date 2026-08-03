import { sendMessage } from 'webext-bridge/popup';
import type { RpcMap } from '../../lib/domain';

type RpcName = keyof RpcMap;
type RpcPayload<K extends RpcName> = Parameters<RpcMap[K]>[0];
type RpcResult<K extends RpcName> = Awaited<ReturnType<RpcMap[K]>>;

export type CompleteUiRpc = {
    [K in RpcName]: (...args: Parameters<RpcMap[K]>) => Promise<RpcResult<K>>;
};

// Read-store dependencies remain narrow; mutation actions can depend on the
// corresponding capabilities as they are implemented.
export type UiRpc = Pick<
    CompleteUiRpc,
    'getInbox' | 'getThread' | 'getReelMedia' | 'getPins' | 'togglePin'
>;

async function call<K extends RpcName>(name: K, payload: RpcPayload<K>) {
    return sendMessage<RpcResult<K>, K>(name, payload as never, 'background');
}

export const uiRpc: CompleteUiRpc = {
    getInbox: payload => call('getInbox', payload),
    getThread: payload => call('getThread', payload),
    getReelMedia: payload => call('getReelMedia', payload),
    getPins: () => call('getPins', undefined),
    togglePin: payload => call('togglePin', payload),
    sendText: payload => call('sendText', payload),
    setReaction: payload => call('setReaction', payload),
};
