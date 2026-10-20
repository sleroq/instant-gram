import { Exit, Schema } from 'effect';
import type { MutationReceipt, MutationRequest } from '../engine/operations.ts';
import { InboxError } from '../engine/resources.ts';

const id = Schema.NonEmptyString;
export const MutationRequestValue = Schema.Struct({
    intent: Schema.Union([
        Schema.Struct({
            type: Schema.Literal('send'),
            threadId: id,
            text: id,
            replyTo: Schema.optional(id),
        }),
        Schema.Struct({
            type: Schema.Literal('pin'),
            threadId: id,
            isPinned: Schema.Boolean,
        }),
        Schema.Struct({
            type: Schema.Literal('read'),
            threadId: id,
            messageId: id,
            timestampMs: Schema.Finite,
        }),
    ]),
    threadFbid: Schema.optional(id),
    threadIgId: Schema.optional(id),
    viewerId: Schema.optional(id),
    offlineThreadingId: id,
});
export const MutationReceiptValue = Schema.Union([
    Schema.Struct({
        type: Schema.Literal('send'),
        threadFbid: id,
        message: Schema.Struct({
            kind: Schema.Literal('text'),
            id,
            senderId: id,
            text: Schema.String,
            ts: Schema.Finite,
            repliedTo: Schema.optional(id),
        }),
    }),
    Schema.Struct({
        type: Schema.Literal('pin'),
        threadFbid: id,
        isPinned: Schema.Boolean,
    }),
    Schema.Struct({
        type: Schema.Literal('read'),
        threadIgId: id,
        messageId: id,
        timestampMs: Schema.Finite,
    }),
]);

export function validateMutationRequest(
    value: MutationRequest,
): MutationRequest {
    const decoded = Schema.decodeUnknownExit(MutationRequestValue)(value);
    if (Exit.isFailure(decoded)) throw new InboxError('invalid_request');
    const request = decoded.value;
    const intent = request.intent;
    if (
        (intent.type !== 'read' && !request.threadFbid) ||
        (intent.type === 'send' &&
            (!request.viewerId ||
                !intent.text.trim() ||
                !/^\d+$/.test(request.offlineThreadingId))) ||
        (intent.type === 'read' &&
            (!request.threadIgId ||
                !request.viewerId ||
                !Number.isSafeInteger(intent.timestampMs) ||
                intent.timestampMs < 0))
    )
        throw new InboxError('invalid_request');
    return request;
}

export function validateMutationReceipt(
    request: MutationRequest,
    receipt: MutationReceipt,
): MutationReceipt {
    const intent = request.intent;
    if (
        intent.type === 'pin' &&
        receipt.type === 'pin' &&
        receipt.threadFbid === request.threadFbid &&
        receipt.isPinned === intent.isPinned
    )
        return receipt;
    if (
        intent.type === 'read' &&
        receipt.type === 'read' &&
        receipt.threadIgId === request.threadIgId &&
        receipt.messageId === intent.messageId &&
        receipt.timestampMs === intent.timestampMs
    )
        return receipt;
    if (
        intent.type === 'send' &&
        receipt.type === 'send' &&
        receipt.threadFbid === request.threadFbid &&
        receipt.message.kind === 'text' &&
        !receipt.message.isSyntheticId &&
        receipt.message.id &&
        receipt.message.senderId === request.viewerId &&
        receipt.message.text === intent.text &&
        receipt.message.repliedTo === intent.replyTo &&
        Number.isSafeInteger(receipt.message.ts) &&
        receipt.message.ts > 0
    )
        return receipt;
    throw new InboxError('unknown_outcome');
}
