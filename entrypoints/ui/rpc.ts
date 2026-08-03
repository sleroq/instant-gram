import { sendMessage } from 'webext-bridge/popup';
import type { RpcMap } from '../../lib/domain';

type RpcName = keyof RpcMap;
type RpcPayload<K extends RpcName> = Parameters<RpcMap[K]>[0];
type RpcResult<K extends RpcName> = Awaited<ReturnType<RpcMap[K]>>;

export type CompleteUiRpc = {
    [K in RpcName]: (...args: Parameters<RpcMap[K]>) => Promise<RpcResult<K>>;
};

// Store/test dependencies only require the core surface; the exported adapter
// below is checked against and exposes the complete RPC map.
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
    getMessageRequests: payload => call('getMessageRequests', payload),
    getThreadInfo: payload => call('getThreadInfo', payload),
    getMessageActions: payload => call('getMessageActions', payload),
    getUnreadCount: () => call('getUnreadCount', undefined),
    sendText: payload => call('sendText', payload),
    setReaction: payload => call('setReaction', payload),
    markThreadRead: payload => call('markThreadRead', payload),
    pinMessage: payload => call('pinMessage', payload),
    sendCutoutSticker: payload => call('sendCutoutSticker', payload),
    executeInstagramGraphql: payload =>
        call('executeInstagramGraphql', payload),
};
