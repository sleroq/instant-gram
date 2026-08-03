import type {
    InstagramGraphqlPayload,
    InstagramRpcMap,
    InstagramSecondaryGraphqlRequest,
    MessageRequestFolder,
    Result,
    RpcMap,
} from '../domain.ts';
import type { InstagramGraphqlOperationName } from './catalog.ts';
import {
    parseInboxResponse,
    parseMarkThreadReadResponse,
    parseMarkThreadReadValidationResponse,
    parseMailboxId,
    parseMessageActionsResponse,
    parseMessageRequestsResponse,
    parsePinnedMessageResponse,
    parseReactionMutationResponse,
    parseSentCutoutStickerResponse,
    parseSentTextResponse,
    parseSecondaryGraphqlResponse,
    parseThreadInfoResponses,
    parseThreadResponse,
    parseUnreadCountResponses,
} from './parsers.ts';

export type InstagramOperationExecutor = (
    operation: InstagramGraphqlOperationName | 'IGDMessageListOffMsysQuery',
    input: Record<string, unknown>,
) => Promise<unknown>;

type RemoteRpcName = Exclude<keyof RpcMap, 'getPins' | 'togglePin' | 'getReelMedia'>;
type ResultValue<T> = T extends Result<infer Value> ? Value : T;
type RemoteHandlers = {
    [K in RemoteRpcName]: (
        payload: Parameters<RpcMap[K]>[0],
    ) => Promise<ResultValue<Awaited<ReturnType<RpcMap[K]>>>>;
};

const MAX_ID_LENGTH = 512;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 10_000;
const MAX_SEARCH_LENGTH = 256;
const MAX_PLAYLIST_PAGE_SIZE = 50;

function record(value: unknown, label = 'payload'): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error(`Invalid Instagram ${label}`);
    return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new Error('Invalid Instagram payload fields');
}

function requiredString(
    value: unknown,
    label: string,
    maxLength = MAX_ID_LENGTH,
): string {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error(`Invalid Instagram ${label}`);
    if (value.length > maxLength) throw new Error(`Instagram ${label} is too long`);
    return value;
}

function optionalString(
    value: unknown,
    label: string,
    maxLength = MAX_ID_LENGTH,
): string | undefined {
    return value === undefined
        ? undefined
        : requiredString(value, label, maxLength);
}

function stringAllowEmpty(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string') throw new Error(`Invalid Instagram ${label}`);
    if (value.length > maxLength) throw new Error(`Instagram ${label} is too long`);
    return value;
}

function clientRequestId(value: unknown): string {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || value.length > MAX_ID_LENGTH)
        throw new Error('Invalid Instagram client request ID');
    return value;
}

function boolean(value: unknown, label: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function positiveInteger(value: unknown, label: string, maximum: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum)
        throw new Error(`Invalid Instagram ${label}`);
    return value as number;
}

function timestamp(value: unknown): number {
    if (
        !Number.isSafeInteger(value) ||
        (value as number) < 946_684_800_000 ||
        (value as number) > 4_102_444_800_000
    )
        throw new Error('Invalid Instagram message timestamp');
    return value as number;
}

function cursor(value: unknown): string | undefined {
    return optionalString(value, 'cursor', MAX_CURSOR_LENGTH);
}

function jsonValue(value: unknown, depth = 0): boolean {
    if (depth > 50) return false;
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean'
    )
        return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => jsonValue(item, depth + 1));
    if (typeof value !== 'object') return false;
    return Object.values(value as Record<string, unknown>).every(item =>
        jsonValue(item, depth + 1),
    );
}

export function parseInstagramGraphqlPayload(
    value: unknown,
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
    if (!jsonValue(data)) throw new Error('Invalid Instagram GraphQL response');
    return { data: data as InstagramGraphqlPayload['data'] };
}

function validateSecondary(
    value: unknown,
): InstagramSecondaryGraphqlRequest {
    const payload = record(value);
    const operation = requiredString(payload.operation, 'operation', 128);
    const noInput = [
        'PolarisAutomaticPreviewsDisabledContextProviderQuery',
        'useFeatureLimitsOffMsysQuery',
        'IGPresenceUnifiedSetupQuery',
        'IGDInboxTrayQuery',
        'IGDEmojiPickerQuery',
        'IGDComposerRichContentTray_AvatarAvailableQuery',
        'IGDComposerRichContentStickersV2_recentStickersQuery',
        'IGDComposerRichContentStickersV2_cutoutStickersQuery',
    ];
    if (noInput.includes(operation)) {
        exactKeys(payload, ['operation']);
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (operation === 'IGDComposerRichContentStickersV2Query') {
        exactKeys(payload, ['operation', 'searchQuery']);
        stringAllowEmpty(payload.searchQuery, 'sticker search', MAX_SEARCH_LENGTH);
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (
        operation === 'IGDComposerRichContentStickersV2ThreadIGIDQuery' ||
        operation === 'IGDComposerRichContentMusicThreadIGIDQuery'
    ) {
        exactKeys(payload, ['operation', 'threadFbid']);
        requiredString(payload.threadFbid, 'thread FBID');
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (operation === 'IGDComposerRichContentMusicQuery') {
        exactKeys(payload, ['operation', 'playlistId']);
        requiredString(payload.playlistId, 'playlist ID');
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (operation === 'IGDComposerRichContentMusicSearchQuery') {
        exactKeys(payload, ['operation', 'query']);
        stringAllowEmpty(payload.query, 'music search', MAX_SEARCH_LENGTH);
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (operation === 'useIGDSystemFolderUnreadThreadCountQuery') {
        exactKeys(payload, ['operation', 'folder', 'newerThanTimestampMs']);
        if (payload.folder !== 'INBOX' && payload.folder !== 'PENDING')
            throw new Error('Invalid Instagram unread folder');
        optionalString(payload.newerThanTimestampMs, 'unread timestamp', 32);
        return payload as InstagramSecondaryGraphqlRequest;
    }
    if (operation === 'playlistMusicRefetchQuery') {
        exactKeys(payload, ['operation', 'playlistId', 'cursor', 'count']);
        requiredString(payload.playlistId, 'playlist ID');
        requiredString(payload.cursor, 'cursor', MAX_CURSOR_LENGTH);
        if (payload.count !== undefined)
            positiveInteger(payload.count, 'count', MAX_PLAYLIST_PAGE_SIZE);
        return payload as InstagramSecondaryGraphqlRequest;
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
): Record<string, unknown> {
    const { operation: _, ...input } = request;
    return input;
}

export function createInstagramRpcHandlers(
    execute: InstagramOperationExecutor,
    options: {
        now?: () => number;
        viewerId?: () => Promise<string>;
    } = {},
): RemoteHandlers {
    const now = options.now ?? Date.now;
    let mailboxId: string | undefined;

    async function requireMailboxId(): Promise<string> {
        if (mailboxId) return mailboxId;
        const json = await execute('PolarisDirectInboxQuery', {});
        mailboxId = parseMailboxId(json);
        if (!mailboxId)
            throw new Error('Instagram inbox did not return a messaging mailbox ID');
        return mailboxId;
    }

    return {
        async getInbox(value: unknown) {
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
        async getThread(value: unknown) {
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
        async getMessageRequests(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['folder', 'cursor']);
            if (payload.folder !== 'REQUESTS' && payload.folder !== 'SPAM')
                throw new Error('Invalid Instagram request folder');
            const folder = payload.folder as MessageRequestFolder;
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
        async getThreadInfo(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid']);
            const threadFbid = requiredString(payload.threadFbid, 'thread FBID');
            const [header, info] = await Promise.all([
                execute('IGDInboxHeaderOffMsysQuery', { threadFbid }),
                execute('IGDInboxInfoOffMsysQuery', { threadFbid }),
            ]);
            return parseThreadInfoResponses(header, info);
        },
        async getMessageActions(value: unknown) {
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
        async getUnreadCount(value: unknown) {
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
        async sendText(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'text', 'replyToMessageId', 'clientRequestId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                text: requiredString(payload.text, 'message text', MAX_TEXT_LENGTH),
                replyToMessageId: optionalString(
                    payload.replyToMessageId,
                    'reply message ID',
                ),
                offlineThreadingId: clientRequestId(payload.clientRequestId),
            };
            return parseSentTextResponse(
                await execute('IGDirectTextSendMutation', input),
                input.offlineThreadingId,
            );
        },
        async setReaction(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'emoji']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                emoji: requiredString(payload.emoji, 'reaction', 32),
            };
            return parseReactionMutationResponse(
                await execute('IGDirectReactionSendMutation', input),
            );
        },
        async markThreadRead(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadIgId', 'messageId', 'messageTimestampMs']);
            const input = {
                threadIgId: requiredString(payload.threadIgId, 'thread IG ID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                messageTimestampMs: timestamp(payload.messageTimestampMs),
            };
            parseMarkThreadReadResponse(
                await execute('useIGDMarkThreadAsReadMutation', input),
            );
            return parseMarkThreadReadValidationResponse(
                await execute('useIGDMarkThreadAsReadValidationMutation', input),
            );
        },
        async pinMessage(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'messageId', 'replaceOldest']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                messageId: requiredString(payload.messageId, 'message ID'),
                replaceOldest: boolean(payload.replaceOldest, 'replace oldest'),
            };
            return parsePinnedMessageResponse(await execute('useIGDPinMessageOffMsysMutation', input));
        },
        async sendCutoutSticker(value: unknown) {
            const payload = record(value);
            exactKeys(payload, ['threadFbid', 'stickerId', 'replyToMessageId', 'clientRequestId']);
            const input = {
                threadFbid: requiredString(payload.threadFbid, 'thread FBID'),
                stickerId: requiredString(payload.stickerId, 'sticker ID'),
                replyToMessageId: optionalString(
                    payload.replyToMessageId,
                    'reply message ID',
                ),
                offlineThreadingId: clientRequestId(payload.clientRequestId),
            };
            return parseSentCutoutStickerResponse(
                await execute('IGDirectCutoutStickerShareMutation', input),
                input.offlineThreadingId,
            );
        },
        async executeInstagramGraphql(value: unknown) {
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
    } as unknown as RemoteHandlers;
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
    useIGDMarkThreadAsReadMutation: 'markThreadRead',
    useIGDMarkThreadAsReadValidationMutation: 'markThreadRead',
    IGDirectTextSendMutation: 'sendText',
    IGDirectReactionSendMutation: 'setReaction',
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
