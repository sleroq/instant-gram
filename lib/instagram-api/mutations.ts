import type { ThreadMessages } from '../domain.ts';
import type { MutationReceipt, MutationRequest } from '../engine/operations.ts';
import { InboxError } from '../engine/resources.ts';
import {
    isJsonObject,
    isString,
    isBoolean,
    type JsonObject,
    type JsonValue,
} from '../json.ts';
import {
    validateMutationReceipt,
    validateMutationRequest,
} from '../provider/mutations.ts';
import type { InstagramGraphqlDescriptor } from './catalog.ts';

function operation(
    friendlyName: string,
    docId: string,
): InstagramGraphqlDescriptor<JsonObject> {
    return {
        friendlyName,
        docId,
        endpoint: '/api/graphql',
        buildVariables: (input) => input,
    };
}
const send = operation('IGDirectTextSendMutation', '26911679871773184');
const pin = operation('useIGDPinThreadMutation', '26491513390471063');
const unpin = operation('useIGDUnpinThreadMutation', '26719492947719993');
const seen = operation('useIGDMarkThreadAsReadMutation', '27356881703909995');
const readValidation = operation(
    'useIGDMarkThreadAsReadValidationMutation',
    '35211594988486314',
);

function result(json: JsonValue, name: string) {
    const data = isJsonObject(json) ? json.data : undefined;
    return isJsonObject(data) ? data[name] : undefined;
}
function unknown(): never {
    throw new InboxError('unknown_outcome');
}

export function createInboxMutator(dependencies: {
    graphql(
        operation: InstagramGraphqlDescriptor<JsonObject>,
        input: JsonObject,
        expected: string,
    ): Promise<{ json: JsonValue; viewerId: string }>;
    history(threadKey: string): Promise<ThreadMessages>;
}) {
    return async (
        expected: string,
        input: MutationRequest,
    ): Promise<MutationReceipt> => {
        const request = validateMutationRequest(input);
        const intent = request.intent;

        if (intent.type === 'pin') {
            const response = await dependencies.graphql(
                intent.isPinned ? pin : unpin,
                { thread_fbid: request.threadFbid!, pin: intent.isPinned },
                expected,
            );
            const value = result(response.json, 'xig_direct_pin_thread');
            if (
                !isJsonObject(value) ||
                !isString(value.id) ||
                !isBoolean(value.is_pin)
            )
                return unknown();
            return validateMutationReceipt(request, {
                type: 'pin',
                threadFbid: value.id,
                isPinned: value.is_pin,
            });
        }
        if (intent.type === 'read') {
            const metadata = { ig_thread_igid: request.threadIgId! };
            const [receipt, validation] = await Promise.all([
                dependencies.graphql(
                    seen,
                    {
                        metadata,
                        data: { item_id: '', message_id: intent.messageId },
                    },
                    expected,
                ),
                dependencies.graphql(
                    readValidation,
                    {
                        metadata,
                        data: {
                            message_id: intent.messageId,
                            message_timestamp_ms: String(intent.timestampMs),
                        },
                    },
                    expected,
                ),
            ]).catch(unknown);
            const value = result(
                receipt.json,
                'xig_direct_item_seen_mutation_with_slide_messaging_response',
            );
            const valid = result(
                validation.json,
                'xig_direct_mark_read_id_validation',
            );
            if (
                !isJsonObject(value) ||
                value.__typename !== 'XFBSlideReadReceipt' ||
                value.participant_fbid !== receipt.viewerId ||
                !receipt.viewerId ||
                validation.viewerId !== receipt.viewerId ||
                !isString(value.watermark_timestamp_ms) ||
                !/^\d+$/.test(value.watermark_timestamp_ms) ||
                !Number.isSafeInteger(Number(value.watermark_timestamp_ms)) ||
                Number(value.watermark_timestamp_ms) < intent.timestampMs ||
                !isBoolean(valid)
            )
                return unknown();
            return {
                type: 'read',
                threadIgId: request.threadIgId!,
                messageId: intent.messageId,
                timestampMs: intent.timestampMs,
            };
        }
        const response = await dependencies.graphql(
            send,
            {
                ig_thread_igid: request.threadFbid!,
                offline_threading_id: request.offlineThreadingId,
                recipient_igids: null,
                replied_to_client_context: null,
                replied_to_item_id: null,
                reply_to_message_id: intent.replyTo ?? null,
                sampled: null,
                text: { sensitive_string_value: intent.text },
                mentions: [],
                mentioned_user_ids: [],
                commands: null,
                forwarded_from_thread_id: null,
                is_forwarded_from_own_message: null,
                send_attribution: 'igd_web_chat_tab:in_thread',
            },
            expected,
        );
        const value = result(
            response.json,
            'xig_direct_text_send_with_slide_messaging_response',
        );
        if (
            !isJsonObject(value) ||
            !isString(value.message_id) ||
            !value.message_id ||
            value.id !== value.message_id ||
            !isString(value.timestamp_ms) ||
            !/^\d+$/.test(value.timestamp_ms)
        )
            return unknown();
        // The captured send receipt has no target or author: require a real history echo.
        const history = await dependencies
            .history(request.threadFbid!)
            .catch(unknown);
        const message = history.items.find(
            (item) => item.id === value.message_id,
        );
        if (
            !message ||
            history.viewerId !== request.viewerId ||
            history.thread?.key !== intent.threadId ||
            history.thread.threadFbid !== request.threadFbid ||
            message.ts !== Number(value.timestamp_ms)
        )
            return unknown();
        return validateMutationReceipt(request, {
            type: 'send',
            threadFbid: request.threadFbid!,
            message,
        });
    };
}
