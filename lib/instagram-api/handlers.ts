import type {
    InstagramGraphqlPayload,
    InstagramRpcMap,
    InstagramSecondaryGraphqlRequest,
    MessageRequestFolder,
    Result,
    RpcMap,
} from '../domain.ts';
import {
    isBoolean,
    isJsonObject,
    isNumber,
    isString,
    type JsonObject,
    type JsonValue,
} from '../json.ts';
import type { InstagramGraphqlOperationName } from './catalog.ts';
import {
    parseInboxResponse,
    parseEditedTextResponse,
    parseForwardedPostResponse,
    parseForwardedReelResponse,
    parseMarkThreadReadResponse,
    parseMarkThreadReadValidationResponse,
    parseMailboxId,
    parseMessageActionsResponse,
    parseMessageRequestsResponse,
    parsePinnedMessageResponse,
    parsePinnedThreadResponse,
    parseReactionMutationResponse,
    parseReelLikeResponse,
    parseReelSaveResponse,
    parseSentCutoutStickerResponse,
    parseSentTextResponse,
    parseSecondaryGraphqlResponse,
    parseThreadInfoResponses,
    parseThreadResponse,
    parseUnreadCountResponses,
} from './parsers.ts';

export type InstagramOperationExecutor = (
    operation: InstagramGraphqlOperationName | 'IGDMessageListOffMsysQuery',
    input: JsonObject,
) => Promise<JsonValue>;

type ResultValue<T> = T extends Result<infer Value> ? Value : T;
type AsyncHandlers<Map extends Record<keyof Map, (...args: never[]) => unknown>> = {
    [K in keyof Map]: ((
        ...args: Parameters<Map[K]>
    ) => Promise<ResultValue<Awaited<ReturnType<Map[K]>>>>) & ((
        value: JsonValue
    ) => Promise<ResultValue<Awaited<ReturnType<Map[K]>>>>);
};
type CanonicalHandlerRpcMap = Pick<
    RpcMap,
    'getInbox' | 'getThread' | 'sendText' | 'editText' | 'forwardMessage' | 'setReaction' | 'setReelLiked' |
    'setReelSaved' | 'togglePin' | 'markThreadRead'
>;
export type InstagramRpcHandlers = AsyncHandlers<CanonicalHandlerRpcMap>;
type CatalogHandlerRpcMap = Pick<
    RpcMap,
    'getInbox' | 'getThread' | 'setReelLiked' | 'setReelSaved'
> & InstagramRpcMap;
export type InstagramCatalogHandlers = AsyncHandlers<CatalogHandlerRpcMap>;

type InstagramHandlerOptions = {
    now?: () => number;
    viewerId?: () => Promise<string>;
};

const MAX_ID_LENGTH = 512;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 10_000;
const MAX_SEARCH_LENGTH = 256;
const MAX_PLAYLIST_PAGE_SIZE = 50;

function record(value: JsonValue | undefined, label = 'payload'): JsonObject {
    if (!isJsonObject(value))
        throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function exactKeys(value: JsonObject, allowed: readonly string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new Error('Invalid Instagram payload fields');
}

function requiredString(
    value: JsonValue | undefined,
    label: string,
    maxLength = MAX_ID_LENGTH,
): string {
    if (!isString(value) || value.trim().length === 0)
        throw new Error(`Invalid Instagram ${label}`);
    if (value.length > maxLength) throw new Error(`Instagram ${label} is too long`);
    return value;
}

function optionalString(
    value: JsonValue | undefined,
    label: string,
    maxLength = MAX_ID_LENGTH,
): string | undefined {
    return value === undefined
        ? undefined
        : requiredString(value, label, maxLength);
}

function stringAllowEmpty(value: JsonValue | undefined, label: string, maxLength: number): string {
    if (!isString(value)) throw new Error(`Invalid Instagram ${label}`);
    if (value.length > maxLength) throw new Error(`Instagram ${label} is too long`);
    return value;
}

function numericStringId(value: JsonValue | undefined, label: string): string {
    if (!isString(value) || !/^\d+$/.test(value) || value.length > MAX_ID_LENGTH)
        throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function boolean(value: JsonValue | undefined, label: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (!isBoolean(value)) throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function positiveInteger(value: JsonValue | undefined, label: string, maximum: number): number {
    if (!isNumber(value) || !Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function timestamp(value: JsonValue | undefined): number {
    if (
        !isNumber(value) ||
        !Number.isSafeInteger(value) ||
        value < 946_684_800_000 ||
        value > 4_102_444_800_000
    )
        throw new Error('Invalid Instagram message timestamp');
    return value;
}

function cursor(value: JsonValue | undefined): string | undefined {
    return optionalString(value, 'cursor', MAX_CURSOR_LENGTH);
}

export function parseInstagramGraphqlPayload(
    value: JsonValue,
): InstagramGraphqlPayload {
    const root = record(value, 'GraphQL response');
    if (root.errors !== undefined) {
        if (!Array.isArray(root.errors))
            throw new Error('Invalid Instagram GraphQL response');
        if (root.errors.length > 0)
            throw new Error('Instagram GraphQL request failed');
    }
    if (root.data === undefined) return {};
    const data = record(root.data, 'GraphQL data');
    return { data };
}

function validateSecondary(
    value: JsonValue,
): InstagramSecondaryGraphqlRequest {
    const payload = record(value);
    const operation = requiredString(payload.operation, 'operation', 128);
    if (operation === 'PolarisAutomaticPreviewsDisabledContextProviderQuery' ||
        operation === 'useFeatureLimitsOffMsysQuery' ||
        operation === 'IGPresenceUnifiedSetupQuery' ||
        operation === 'IGDInboxTrayQuery' ||
        operation === 'IGDEmojiPickerQuery' ||
        operation === 'IGDComposerRichContentTray_AvatarAvailableQuery' ||
        operation === 'IGDComposerRichContentStickersV2_recentStickersQuery' ||
        operation === 'IGDComposerRichContentStickersV2_cutoutStickersQuery') {
        exactKeys(payload, ['operation']);
        return { operation };
    }
    if (operation === 'IGDComposerRichContentStickersV2Query') {
        exactKeys(payload, ['operation', 'searchQuery']);
        const searchQuery = stringAllowEmpty(payload.searchQuery, 'sticker search', MAX_SEARCH_LENGTH);
        return { operation, searchQuery };
    }
    if (
        operation === 'IGDComposerRichContentStickersV2ThreadIGIDQuery' ||
        operation === 'IGDComposerRichContentMusicThreadIGIDQuery'
    ) {
        exactKeys(payload, ['operation', 'threadFbid']);
        const threadFbid = requiredString(payload.threadFbid, 'thread FBID');
        return { operation, threadFbid };
    }
    if (operation === 'IGDComposerRichContentMusicQuery') {
        exactKeys(payload, ['operation', 'playlistId']);
        const playlistId = requiredString(payload.playlistId, 'playlist ID');
        return { operation, playlistId };
    }
    if (operation === 'IGDComposerRichContentMusicSearchQuery') {
        exactKeys(payload, ['operation', 'query']);
        const query = stringAllowEmpty(payload.query, 'music search', MAX_SEARCH_LENGTH);
        return { operation, query };
    }
    if (operation === 'useIGDSystemFolderUnreadThreadCountQuery') {
        exactKeys(payload, ['operation', 'folder', 'newerThanTimestampMs']);
        if (payload.folder !== 'INBOX' && payload.folder !== 'PENDING')
            throw new Error('Invalid Instagram unread folder');
        const newerThanTimestampMs = optionalString(payload.newerThanTimestampMs, 'unread timestamp', 32);
        const request: InstagramSecondaryGraphqlRequest = { operation, folder: payload.folder };
        if (newerThanTimestampMs !== undefined) request.newerThanTimestampMs = newerThanTimestampMs;
        return request;
    }
    if (operation === 'playlistMusicRefetchQuery') {
        exactKeys(payload, ['operation', 'playlistId', 'cursor', 'count']);
        const playlistId = requiredString(payload.playlistId, 'playlist ID');
        const playlistCursor = requiredString(payload.cursor, 'cursor', MAX_CURSOR_LENGTH);
        const request: InstagramSecondaryGraphqlRequest = { operation, playlistId, cursor: playlistCursor };
        if (payload.count !== undefined)
            request.count = positiveInteger(payload.count, 'count', MAX_PLAYLIST_PAGE_SIZE);
        return request;
    }
    throw new Error('Unsupported Instagram GraphQL operation');
}

export function generateOfflineThreadingId(): string {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return ((BigInt(Date.now()) << 22n) | BigInt(random[0] & 0x3f_ffff)).toString();
}

function secondaryInput(
    request: InstagramSecondaryGraphqlRequest,
): JsonObject {
    const { operation: _, ...input } = request;
    return input;
}

function createInstagramHandlers(
    execute: InstagramOperationExecutor,
    options: InstagramHandlerOptions,
) {
    const now = options.now ?? Date.now;
    let mailboxId: string | undefined;
    let reelMutationId = 0;

    async function requireMailboxId(): Promise<string> {
        if (mailboxId) return mailboxId;
        const json = await execute('PolarisDirectInboxQuery', {});
        mailboxId = parseMailboxId(json);
        if (!mailboxId)
            throw new Error('Instagram inbox did not return a messaging mailbox ID');
        return mailboxId;
    }

    return {
        async getInbox(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['cursor']);
            const nextCursor = cursor(payload.cursor);
            const json = nextCursor
                ? await execute('IGDThreadListOffMsysPaginationQuery', {
                      count: 5,
                      cursor: nextCursor,
                      folder: 'INBOX',
                      newerThanTimestampMs: null,
                      mailboxId: await requireMailboxId(),
                  })
                : await execute('PolarisDirectInboxQuery', {});
            mailboxId = parseMailboxId(json) ?? mailboxId;
            return parseInboxResponse(json);
        },
        async getThread(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadKey', 'cursor']);
            const threadKey = requiredString(payload.threadKey, 'thread ID');
            const nextCursor = cursor(payload.cursor);
            const json = nextCursor
                ? await execute('IGDMessageListOffMsysQuery', {
                      threadKey,
                      cursor: nextCursor,
                  })
                : await execute('IGDThreadDetailQuery', { threadKey });
            return parseThreadResponse(
                json,
                options.viewerId ? await options.viewerId() : '',
            );
        },
        async getMessageRequests(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['folder', 'cursor']);
            if (payload.folder !== 'REQUESTS' && payload.folder !== 'SPAM')
                throw new Error('Invalid Instagram request folder');
            const folder: MessageRequestFolder = payload.folder;
            const nextCursor = cursor(payload.cursor);
            const json = nextCursor
                ? await execute('IGDThreadListOffMsysPaginationQuery', {
                      count: 5,
                      cursor: nextCursor,
                      folder: folder === 'REQUESTS' ? 'PENDING' : 'JUNK',
                      newerThanTimestampMs: null,
                      mailboxId: await requireMailboxId(),
                  })
                : await execute('PolarisDirectMessageRequestQuery', {
                      thirtyDaysAgoTimestampMs: String(now() - 30 * 24 * 60 * 60 * 1_000),
                  });
            mailboxId = parseMailboxId(json) ?? mailboxId;
            return parseMessageRequestsResponse(json, folder);
        },
        async getThreadInfo(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid']);
            const threadFbid = requiredString(payload.threadFbid, 'thread FBID');
            const [header, info] = await Promise.all([
                execute('IGDInboxHeaderOffMsysQuery', { threadFbid }),
                execute('IGDInboxInfoOffMsysQuery', { threadFbid }),
            ]);
            return parseThreadInfoResponses(header, info);
        },
        async getMessageActions(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'senderId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                senderId: requiredString(payload.senderId, 'sender ID'),
            };
            return parseMessageActionsResponse(
                await execute('IGDUserMessageRowMoreActionsMenuOffMsysQuery', input),
            );
        },
        async getUnreadCount(value?: JsonValue) {
            if (value !== undefined) {
                const payload = record(value);
                exactKeys(payload, []);
            }
            const thirtyDaysAgo = String(now() - 30 * 24 * 60 * 60 * 1_000);
            const [inbox, requests] = await Promise.all([
                execute('IGDBadgeCountOffMsysQuery', {}),
                execute('PolarisDirectMessageRequestQuery', {
                    thirtyDaysAgoTimestampMs: thirtyDaysAgo,
                }),
            ]);
            return parseUnreadCountResponses(inbox, requests);
        },
        async sendText(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'text', 'replyToMessageId', 'offlineThreadingId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                text: requiredString(payload.text, 'message text', MAX_TEXT_LENGTH),
                replyToMessageId: optionalString(
                    payload.replyToMessageId,
                    'reply message ID',
                ),
                offlineThreadingId: numericStringId(
                    payload.offlineThreadingId,
                    'offline threading ID',
                ),
            };
            return parseSentTextResponse(
                await execute('IGDirectTextSendMutation', input),
                input.offlineThreadingId,
            );
        },
        async editText(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'text', 'offlineThreadingId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                targetMessageId: requiredString(payload.messageId, 'message ID'),
                text: requiredString(payload.text, 'message text', MAX_TEXT_LENGTH),
                offlineThreadingId: numericStringId(
                    payload.offlineThreadingId,
                    'offline threading ID',
                ),
            };
            const receipt = parseEditedTextResponse(
                await execute('IGDirectEditMessageMutation', input),
            );
            if (receipt.messageId !== input.targetMessageId)
                throw new Error('Instagram edited message receipt did not match the request');
            return receipt;
        },
        async forwardMessage(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, [
                'targetThreadFbid', 'sourceThreadIgId',
                'sourceIsViewer', 'offlineThreadingId', 'content',
            ]);
            const targetThreadFbid = requiredString(payload.targetThreadFbid, 'target thread FBID');
            const sourceThreadIgId = requiredString(payload.sourceThreadIgId, 'source thread IG ID');
            const offlineThreadingId = numericStringId(payload.offlineThreadingId, 'offline threading ID');
            if (!isBoolean(payload.sourceIsViewer))
                throw new Error('Invalid Instagram forwarding sender state');
            const content = record(payload.content, 'forwarding content');
            if (content.kind === 'text') {
                exactKeys(content, ['kind', 'text']);
                const text = requiredString(content.text, 'forwarded text', MAX_TEXT_LENGTH);
                return parseSentTextResponse(await execute('IGDirectTextSendMutation', {
                    threadFbid: targetThreadFbid,
                    offlineThreadingId,
                    text,
                    forwardedFromThreadId: sourceThreadIgId,
                    isForwardedFromOwnMessage: payload.sourceIsViewer,
                }), offlineThreadingId);
            }
            if (content.kind === 'reel') {
                exactKeys(content, ['kind', 'mediaId']);
                return parseForwardedReelResponse(await execute('IGDirectReelShareMutation', {
                    targetThreadFbid,
                    sourceThreadIgId,
                    sourceIsViewer: payload.sourceIsViewer,
                    offlineThreadingId,
                    mediaId: numericStringId(content.mediaId, 'forwarded media ID'),
                }), offlineThreadingId);
            }
            if (content.kind === 'post') {
                exactKeys(content, ['kind', 'mediaId']);
                return parseForwardedPostResponse(await execute('IGDirectMediaShareMutation', {
                    targetThreadFbid,
                    sourceThreadIgId,
                    sourceIsViewer: payload.sourceIsViewer,
                    offlineThreadingId,
                    mediaId: numericStringId(content.mediaId, 'forwarded media ID'),
                }), offlineThreadingId);
            }
            throw new Error('Unsupported Instagram forwarding content');
        },
        async setReaction(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'emoji', 'remove']);
            if (!isBoolean(payload.remove))
                throw new Error('Invalid Instagram reaction removal state');
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                emoji: requiredString(payload.emoji, 'reaction', 32),
                remove: payload.remove,
            };
            return parseReactionMutationResponse(
                await execute('IGDirectReactionSendMutation', input),
            );
        },
        async setReelLiked(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['mediaId', 'liked']);
            const mediaId = numericStringId(payload.mediaId, 'reel media ID');
            if (!isBoolean(payload.liked))
                throw new Error('Invalid Instagram reel liked state');
            const input = {
                mediaId,
                clientMutationId: String(++reelMutationId),
            };
            const receipt = parseReelLikeResponse(await execute(
                payload.liked ? 'PolarisAPILikePostMutation' : 'PolarisAPIUnlikePostMutation',
                input,
            ), payload.liked);
            if (receipt.mediaId !== mediaId || receipt.hasLiked !== payload.liked)
                throw new Error('Instagram reel like receipt did not match the request');
            return receipt;
        },
        async setReelSaved(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['mediaId', 'saved']);
            const mediaId = numericStringId(payload.mediaId, 'reel media ID');
            if (!isBoolean(payload.saved))
                throw new Error('Invalid Instagram reel saved state');
            const input = {
                mediaId,
                clientMutationId: String(++reelMutationId),
            };
            const receipt = parseReelSaveResponse(await execute(
                payload.saved ? 'PolarisAPISavePostMutation' : 'PolarisAPIUnsavePostMutation',
                input,
            ), payload.saved);
            if (receipt.mediaId !== mediaId || receipt.hasSaved !== payload.saved)
                throw new Error('Instagram reel save receipt did not match the request');
            return receipt;
        },
        async togglePin(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadKey', 'threadFbid', 'pin']);
            requiredString(payload.threadKey, 'thread key');
            const input = {
                threadFbid: numericStringId(payload.threadFbid, 'thread FBID'),
            };
            if (!isBoolean(payload.pin))
                throw new Error('Invalid Instagram conversation pin state');
            const receipt = parsePinnedThreadResponse(await execute(
                payload.pin ? 'useIGDPinThreadMutation' : 'useIGDUnpinThreadMutation',
                input,
            ));
            if (receipt.threadFbid !== input.threadFbid || receipt.isPinned !== payload.pin)
                throw new Error('Instagram conversation pin receipt did not match the request');
            return { pinned: [], receipt };
        },
        async markThreadRead(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadIgId', 'messageId', 'messageTimestampMs']);
            const input = {
                threadIgId: requiredString(payload.threadIgId, 'thread IG ID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                messageTimestampMs: timestamp(payload.messageTimestampMs),
            };
            const [receipt, validation] = await Promise.allSettled([
                execute('useIGDMarkThreadAsReadMutation', input),
                execute('useIGDMarkThreadAsReadValidationMutation', input),
            ]);
            const failures: string[] = [];
            if (receipt.status === 'rejected') {
                failures.push(`receipt: ${receipt.reason instanceof Error ? receipt.reason.message : String(receipt.reason)}`);
            } else {
                try {
                    parseMarkThreadReadResponse(receipt.value);
                } catch (error) {
                    failures.push(`receipt: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            let parsedValidation: ReturnType<typeof parseMarkThreadReadValidationResponse> | undefined;
            if (validation.status === 'rejected') {
                failures.push(`validation: ${validation.reason instanceof Error ? validation.reason.message : String(validation.reason)}`);
            } else {
                try {
                    parsedValidation = parseMarkThreadReadValidationResponse(validation.value);
                } catch (error) {
                    failures.push(`validation: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (failures.length)
                throw new Error(`Instagram mark-read request failed (${failures.join('; ')})`);
            return parsedValidation!;
        },
        async pinMessage(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'replaceOldest']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                replaceOldest: boolean(payload.replaceOldest, 'replace oldest'),
            };
            return parsePinnedMessageResponse(await execute('useIGDPinMessageOffMsysMutation', input));
        },
        async sendCutoutSticker(value: JsonValue) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'stickerId', 'replyToMessageId', 'clientRequestId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                stickerId: requiredString(payload.stickerId, 'sticker ID'),
                replyToMessageId: optionalString(
                    payload.replyToMessageId,
                    'reply message ID',
                ),
                offlineThreadingId: numericStringId(
                    payload.clientRequestId,
                    'client request ID',
                ),
            };
            return parseSentCutoutStickerResponse(
                await execute('IGDirectCutoutStickerShareMutation', input),
                input.offlineThreadingId,
            );
        },
        async executeInstagramGraphql(value: JsonValue) {
            const request = validateSecondary(value);
            const json = await execute(request.operation, secondaryInput(request));
            const sanitized = parseInstagramGraphqlPayload(json);
            const setupOperations = [
                'PolarisAutomaticPreviewsDisabledContextProviderQuery',
                'useFeatureLimitsOffMsysQuery',
                'IGPresenceUnifiedSetupQuery',
                'IGDInboxTrayQuery',
                'useIGDSystemFolderUnreadThreadCountQuery',
            ];
            return setupOperations.includes(request.operation)
                ? { operation: request.operation, payload: sanitized }
                : parseSecondaryGraphqlResponse(request.operation, json);
        },
    } satisfies InstagramRpcHandlers & InstagramCatalogHandlers;
}

/** Handlers exposed by the canonical extension bridge. */
export function createInstagramRpcHandlers(
    execute: InstagramOperationExecutor,
    options: InstagramHandlerOptions = {},
): InstagramRpcHandlers {
    const handlers = createInstagramHandlers(execute, options);
    return {
        getInbox: handlers.getInbox,
        getThread: handlers.getThread,
        sendText: handlers.sendText,
        editText: handlers.editText,
        forwardMessage: handlers.forwardMessage,
        setReaction: handlers.setReaction,
        setReelLiked: handlers.setReelLiked,
        setReelSaved: handlers.setReelSaved,
        togglePin: handlers.togglePin,
        markThreadRead: handlers.markThreadRead,
    };
}

/** Prospective API catalog handlers that are deliberately not bridge routes. */
export function createInstagramCatalogHandlers(
    execute: InstagramOperationExecutor,
    options: InstagramHandlerOptions = {},
): InstagramCatalogHandlers {
    return createInstagramHandlers(execute, options);
}

export const INSTAGRAM_RPC_OPERATION_REACHABILITY = {
    PolarisDirectInboxQuery: 'getInbox',
    IGDThreadListOffMsysPaginationQuery: 'getInbox/getMessageRequests',
    PolarisDirectMessageRequestQuery: 'getMessageRequests',
    IGDBadgeCountOffMsysQuery: 'getUnreadCount',
    useIGDSystemFolderUnreadThreadCountQuery: 'executeInstagramGraphql',
    IGDInboxTrayQuery: 'executeInstagramGraphql',
    PolarisAutomaticPreviewsDisabledContextProviderQuery: 'executeInstagramGraphql',
    useFeatureLimitsOffMsysQuery: 'executeInstagramGraphql',
    IGPresenceUnifiedSetupQuery: 'executeInstagramGraphql',
    IGDThreadDetailQuery: 'getThread',
    IGDInboxHeaderOffMsysQuery: 'getThreadInfo',
    IGDInboxInfoOffMsysQuery: 'getThreadInfo',
    IGDUserMessageRowMoreActionsMenuOffMsysQuery: 'getMessageActions',
    useIGDPinMessageOffMsysMutation: 'pinMessage',
    useIGDPinThreadMutation: 'togglePin',
    useIGDUnpinThreadMutation: 'togglePin',
    useIGDMarkThreadAsReadMutation: 'markThreadRead',
    useIGDMarkThreadAsReadValidationMutation: 'markThreadRead',
    IGDirectTextSendMutation: 'sendText',
    IGDirectEditMessageMutation: 'editText',
    IGDirectReelShareMutation: 'forwardMessage',
    IGDirectMediaShareMutation: 'forwardMessage',
    IGDirectReactionSendMutation: 'setReaction',
    PolarisAPILikePostMutation: 'setReelLiked',
    PolarisAPIUnlikePostMutation: 'setReelLiked',
    PolarisCommentActionsLikeMutation: 'setReelCommentLiked',
    PolarisAPISavePostMutation: 'setReelSaved',
    PolarisAPIUnsavePostMutation: 'setReelSaved',
    PolarisUserHoverCardContentV2Query: 'getReelMedia',
    IGDEmojiPickerQuery: 'executeInstagramGraphql',
    IGDComposerRichContentTray_AvatarAvailableQuery: 'executeInstagramGraphql',
    IGDComposerRichContentStickersV2Query: 'executeInstagramGraphql',
    IGDComposerRichContentStickersV2_recentStickersQuery: 'executeInstagramGraphql',
    IGDComposerRichContentStickersV2_cutoutStickersQuery: 'executeInstagramGraphql',
    IGDComposerRichContentStickersV2ThreadIGIDQuery: 'executeInstagramGraphql',
    IGDirectCutoutStickerShareMutation: 'sendCutoutSticker',
    IGDComposerRichContentMusicQuery: 'executeInstagramGraphql',
    IGDComposerRichContentMusicSearchQuery: 'executeInstagramGraphql',
    IGDComposerRichContentMusicThreadIGIDQuery: 'executeInstagramGraphql',
    playlistMusicRefetchQuery: 'executeInstagramGraphql',
} as const satisfies Record<InstagramGraphqlOperationName, string>;
