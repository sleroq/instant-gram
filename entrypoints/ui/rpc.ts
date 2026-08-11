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
    'getInbox' | 'getThread' | 'getReelMedia' | 'getReelComments' |
    'getReelCommentReplies' | 'createReelComment' | 'setReelCommentLiked' |
    'setReelLiked' | 'setReelSaved' | 'getPins' | 'togglePin'
>;

async function call<K extends RpcName>(name: K, payload: RpcPayload<K>) {
    return sendMessage<RpcResult<K>, K>(name, payload as never, 'background');
}

export const uiRpc: CompleteUiRpc = {
    getInbox: payload => call('getInbox', payload),
    getThread: payload => call('getThread', payload),
    getReelMedia: payload => call('getReelMedia', payload),
    getReelComments: payload => call('getReelComments', payload),
    getReelCommentReplies: payload => call('getReelCommentReplies', payload),
    createReelComment: payload => call('createReelComment', payload),
    setReelCommentLiked: payload => call('setReelCommentLiked', payload),
    setReelLiked: payload => call('setReelLiked', payload),
    setReelSaved: payload => call('setReelSaved', payload),
    getPins: () => call('getPins', undefined),
    togglePin: payload => call('togglePin', payload),
    sendText: payload => call('sendText', payload),
    editText: payload => call('editText', payload),
    forwardMessage: payload => call('forwardMessage', payload),
    setReaction: payload => call('setReaction', payload),
    markThreadRead: payload => call('markThreadRead', payload),
};
