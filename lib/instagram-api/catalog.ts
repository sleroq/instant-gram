import {
    DOC_IDS,
    FRIENDLY_NAMES,
    INSTAGRAM_GRAPHQL_FLAGS as FLAGS,
} from '../config.ts';

export type InstagramGraphqlContext = {
    viewerId: string;
    deviceId: string;
};

export type InstagramGraphqlDescriptor<Input> = {
    friendlyName: string;
    docId: string;
    endpoint: '/api/graphql';
    kind: 'query' | 'mutation';
    buildVariables: (
        input: Input,
        context: InstagramGraphqlContext,
    ) => Record<string, unknown>;
};

const query = <Input>(
    friendlyName: string,
    docId: string,
    buildVariables: InstagramGraphqlDescriptor<Input>['buildVariables'],
): InstagramGraphqlDescriptor<Input> => ({
    friendlyName,
    docId,
    endpoint: '/api/graphql',
    kind: 'query',
    buildVariables,
});

const mutation = <Input>(
    friendlyName: string,
    docId: string,
    buildVariables: InstagramGraphqlDescriptor<Input>['buildVariables'],
): InstagramGraphqlDescriptor<Input> => ({
    friendlyName,
    docId,
    endpoint: '/api/graphql',
    kind: 'mutation',
    buildVariables,
});

const empty = () => ({});
const listFlags = {
    __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider:
        FLAGS.pinnedThreads,
    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider:
        FLAGS.maxUnreadMessages,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:
        FLAGS.aiAccountLabel,
    __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider:
        FLAGS.threadListActions,
};
const threadFlags = {
    __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider:
        FLAGS.chatThemes,
    __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:
        FLAGS.initialMessagePageCount,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:
        FLAGS.aiAccountLabel,
};
const musicParams = (playlistId: string) => ({
    playlist_id: playlistId,
    product: 'IG_DIRECT_MUSIC_STICKER',
});

export const INSTAGRAM_GRAPHQL_OPERATIONS = {
    PolarisDirectInboxQuery: query(
        FRIENDLY_NAMES.inbox,
        DOC_IDS.inbox,
        (_: Record<string, never>, context) => ({
            device_id_for_iris_subscription: context.deviceId,
            __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider:
                FLAGS.isProfessionalAccount,
            ...listFlags,
        }),
    ),
    IGDThreadListOffMsysPaginationQuery: query(
        FRIENDLY_NAMES.inboxPage,
        DOC_IDS.inboxPage,
        (input: {
            count: number;
            cursor: string;
            folder: 'INBOX' | 'PENDING' | 'JUNK';
            newerThanTimestampMs: string | null;
            mailboxId: string;
        }) => ({
            count: input.count,
            cursor: input.cursor,
            folder: input.folder,
            newer_than_timestamp_ms: input.newerThanTimestampMs,
            id: input.mailboxId,
            ...listFlags,
        }),
    ),
    PolarisDirectMessageRequestQuery: query(
        FRIENDLY_NAMES.messageRequests,
        DOC_IDS.messageRequests,
        (input: { thirtyDaysAgoTimestampMs: string }, context) => ({
            device_id_for_iris_subscription: context.deviceId,
            __relay_internal__pv__IGD30DayAgoTimestampMsrelayprovider:
                input.thirtyDaysAgoTimestampMs,
            ...listFlags,
        }),
    ),
    IGDBadgeCountOffMsysQuery: query(
        FRIENDLY_NAMES.badgeCount,
        DOC_IDS.badgeCount,
        (_: Record<string, never>, context) => ({
            device_id_for_iris_subscription: context.deviceId,
        }),
    ),
    useIGDSystemFolderUnreadThreadCountQuery: query(
        FRIENDLY_NAMES.systemFolderUnreadCount,
        DOC_IDS.systemFolderUnreadCount,
        (input: { folder: 'INBOX' | 'PENDING'; newerThanTimestampMs?: string }, context) => ({
            device_id_for_iris_subscription: context.deviceId,
            folder: input.folder,
            ...(input.newerThanTimestampMs === undefined
                ? {}
                : { newer_than_timestamp_ms: input.newerThanTimestampMs }),
        }),
    ),
    IGDInboxTrayQuery: query(FRIENDLY_NAMES.inboxTray, DOC_IDS.inboxTray, empty),
    PolarisAutomaticPreviewsDisabledContextProviderQuery: query(
        FRIENDLY_NAMES.automaticPreviewsDisabled,
        DOC_IDS.automaticPreviewsDisabled,
        empty,
    ),
    useFeatureLimitsOffMsysQuery: query(
        FRIENDLY_NAMES.featureLimits,
        DOC_IDS.featureLimits,
        empty,
    ),
    IGPresenceUnifiedSetupQuery: query(
        FRIENDLY_NAMES.presenceSetup,
        DOC_IDS.presenceSetup,
        empty,
    ),
    IGDThreadDetailQuery: query(
        FRIENDLY_NAMES.thread,
        DOC_IDS.thread,
        (input: { threadKey: string; minUqSeqId?: number | null }) => ({
            ...(input.minUqSeqId === undefined
                ? {}
                : { min_uq_seq_id: input.minUqSeqId }),
            thread_fbid: input.threadKey,
            ...threadFlags,
        }),
    ),
    IGDInboxHeaderOffMsysQuery: query(
        FRIENDLY_NAMES.inboxHeader,
        DOC_IDS.inboxHeader,
        (input: { threadFbid: string; minUqSeqId?: number }) => ({
            ...(input.minUqSeqId === undefined
                ? {}
                : { min_uq_seq_id: input.minUqSeqId }),
            thread_fbid: input.threadFbid,
            __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:
                FLAGS.aiAccountLabel,
        }),
    ),
    IGDInboxInfoOffMsysQuery: query(
        FRIENDLY_NAMES.inboxInfo,
        DOC_IDS.inboxInfo,
        (input: { threadFbid: string }) => ({
            thread_fbid: input.threadFbid,
            __relay_internal__pv__IGDGroupLinksEnabledGKrelayprovider:
                FLAGS.groupLinks,
            __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider:
                FLAGS.chatThemes,
        }),
    ),
    IGDUserMessageRowMoreActionsMenuOffMsysQuery: query(
        FRIENDLY_NAMES.messageActions,
        DOC_IDS.messageActions,
        (input: { threadFbid: string; messageId: string; senderId: string }) => ({
            message_id: input.messageId,
            sender_id: input.senderId,
            shouldFetchInspectData: false,
            thread_fbid: input.threadFbid,
        }),
    ),
    useIGDPinMessageOffMsysMutation: mutation(
        FRIENDLY_NAMES.pinMessage,
        DOC_IDS.pinMessage,
        (input: { threadFbid: string; messageId: string; replaceOldest?: boolean }) => ({
            thread_fbid: input.threadFbid,
            message_id: input.messageId,
            should_replace_oldest_pin: input.replaceOldest ?? false,
        }),
    ),
    useIGDPinThreadMutation: mutation(
        FRIENDLY_NAMES.pinThread,
        DOC_IDS.pinThread,
        (input: { threadFbid: string }) => ({
            thread_fbid: input.threadFbid,
            pin: true,
        }),
    ),
    useIGDUnpinThreadMutation: mutation(
        FRIENDLY_NAMES.unpinThread,
        DOC_IDS.unpinThread,
        (input: { threadFbid: string }) => ({
            thread_fbid: input.threadFbid,
            pin: false,
        }),
    ),
    useIGDMarkThreadAsReadMutation: mutation(
        FRIENDLY_NAMES.markThreadRead,
        DOC_IDS.markThreadRead,
        (input: { threadIgId: string; messageId: string }) => ({
            metadata: { ig_thread_igid: input.threadIgId },
            data: { item_id: '', message_id: input.messageId },
        }),
    ),
    useIGDMarkThreadAsReadValidationMutation: mutation(
        FRIENDLY_NAMES.markThreadReadValidation,
        DOC_IDS.markThreadReadValidation,
        (input: { threadIgId: string; messageId: string; messageTimestampMs: number }) => ({
            metadata: { ig_thread_igid: input.threadIgId },
            data: {
                message_id: input.messageId,
                message_timestamp_ms: String(input.messageTimestampMs),
            },
        }),
    ),
    IGDirectTextSendMutation: mutation(
        FRIENDLY_NAMES.sendText,
        DOC_IDS.sendText,
        (input: { threadFbid: string; offlineThreadingId: string; text: string; replyToMessageId?: string }) => ({
            ig_thread_igid: input.threadFbid,
            offline_threading_id: input.offlineThreadingId,
            recipient_igids: null,
            replied_to_client_context: null,
            replied_to_item_id: null,
            reply_to_message_id: input.replyToMessageId ?? null,
            sampled: null,
            text: { sensitive_string_value: input.text },
            mentions: [],
            mentioned_user_ids: [],
            commands: null,
            forwarded_from_thread_id: null,
            is_forwarded_from_own_message: null,
            send_attribution: 'igd_web_chat_tab:in_thread',
        }),
    ),
    IGDirectReactionSendMutation: mutation(
        FRIENDLY_NAMES.sendReaction,
        DOC_IDS.sendReaction,
        (input: { threadFbid: string; messageId: string; emoji: string }) => ({
            input: {
                emoji: input.emoji,
                item_id: '',
                message_id: input.messageId,
                reaction_status: 'created',
                thread_id: input.threadFbid,
            },
        }),
    ),
    IGDEmojiPickerQuery: query(
        FRIENDLY_NAMES.emojiPicker,
        DOC_IDS.emojiPicker,
        () => ({
            category_ids: [
                '1795127124089732',
                '1117693864983467',
                '337864463246293',
                '1251900681534964',
                '189719128099581',
                '629625430553130',
                '1642676819358192',
                '1068040353319407',
            ],
        }),
    ),
    IGDComposerRichContentTray_AvatarAvailableQuery: query(
        FRIENDLY_NAMES.avatarAvailable,
        DOC_IDS.avatarAvailable,
        (_: Record<string, never>, context) => ({ user_id: context.viewerId }),
    ),
    IGDComposerRichContentStickersV2Query: query(
        FRIENDLY_NAMES.stickers,
        DOC_IDS.stickers,
        (input: { searchQuery: string }) => ({ search_query: input.searchQuery }),
    ),
    IGDComposerRichContentStickersV2_recentStickersQuery: query(
        FRIENDLY_NAMES.recentStickers,
        DOC_IDS.recentStickers,
        empty,
    ),
    IGDComposerRichContentStickersV2_cutoutStickersQuery: query(
        FRIENDLY_NAMES.cutoutStickers,
        DOC_IDS.cutoutStickers,
        empty,
    ),
    IGDComposerRichContentStickersV2ThreadIGIDQuery: query(
        FRIENDLY_NAMES.stickerThreadIgId,
        DOC_IDS.stickerThreadIgId,
        (input: { threadFbid: string }) => ({ thread_fbid: input.threadFbid }),
    ),
    IGDirectCutoutStickerShareMutation: mutation(
        FRIENDLY_NAMES.sendCutoutSticker,
        DOC_IDS.sendCutoutSticker,
        (input: { threadFbid: string; offlineThreadingId: string; stickerId: string; replyToMessageId?: string }) => ({
            send_data: {
                forwarded_from_thread_id: null,
                is_forwarded_from_own_message: null,
                offline_threading_id: input.offlineThreadingId,
                recipient_users: null,
                reply_to_message_id: input.replyToMessageId ?? null,
                thread_id: input.threadFbid,
            },
            data: { sticker_id: input.stickerId },
        }),
    ),
    IGDComposerRichContentMusicQuery: query(
        FRIENDLY_NAMES.music,
        DOC_IDS.music,
        (input: { playlistId: string }) => ({ params: musicParams(input.playlistId) }),
    ),
    IGDComposerRichContentMusicSearchQuery: query(
        FRIENDLY_NAMES.musicSearch,
        DOC_IDS.musicSearch,
        (input: { query: string }) => ({
            params: { product: 'IG_DIRECT_MUSIC_STICKER', q: input.query },
        }),
    ),
    IGDComposerRichContentMusicThreadIGIDQuery: query(
        FRIENDLY_NAMES.musicThreadIgId,
        DOC_IDS.musicThreadIgId,
        (input: { threadFbid: string }) => ({ thread_fbid: input.threadFbid }),
    ),
    playlistMusicRefetchQuery: query(
        FRIENDLY_NAMES.musicPlaylistPage,
        DOC_IDS.musicPlaylistPage,
        (input: { playlistId: string; cursor: string; count?: number }) => ({
            count: input.count ?? 5,
            cursor: input.cursor,
            params: musicParams(input.playlistId),
        }),
    ),
} as const;

export type InstagramGraphqlOperationName =
    keyof typeof INSTAGRAM_GRAPHQL_OPERATIONS;

export function isInstagramGraphqlOperationName(
    value: string,
): value is InstagramGraphqlOperationName {
    return Object.hasOwn(INSTAGRAM_GRAPHQL_OPERATIONS, value);
}
