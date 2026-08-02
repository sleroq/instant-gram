import { sendMessage } from 'webext-bridge/popup';
import type { RpcMap } from '../../lib/domain';

type RpcName = keyof RpcMap;
type RpcPayload<K extends RpcName> = Parameters<RpcMap[K]>[0];
type RpcResult<K extends RpcName> = Awaited<ReturnType<RpcMap[K]>>;

export type UiRpc = {
    [K in RpcName]: (...args: Parameters<RpcMap[K]>) => Promise<RpcResult<K>>;
};

async function call<K extends RpcName>(name: K, payload: RpcPayload<K>) {
    return sendMessage<RpcResult<K>, K>(name, payload as never, 'background');
}

export const uiRpc: UiRpc = {
    getInbox: payload => call('getInbox', payload),
    getThread: payload => call('getThread', payload),
    getReelMedia: payload => call('getReelMedia', payload),
    getPins: () => call('getPins', undefined),
    togglePin: payload => call('togglePin', payload),
};
