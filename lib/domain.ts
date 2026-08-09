export type Folder = 'PRIMARY' | 'GENERAL' | 'REQUESTS';

export type User = {
    id: string;
    username: string;
    fullName: string;
    picUrl: string | null;
};

export type MessageReaction = {
    senderId: string;
    reaction: string;
    timestampMs?: number;
};

export type MessageImage = {
    url: string;
    previewUrl?: string;
    width?: number;
    height?: number;
};

export type MessageFallback = {
    label: string;
    preview?: string;
    targetUrl?: string;
    thumbUrl?: string;
};

type MessageMetadata = {
    id: string;
    ts: number;
    /** Authoritative reaction state attached to the target message. */
    reactions?: MessageReaction[];
    isPinned?: boolean;
};

type SentMessageMetadata = {
    senderId: string;
    repliedTo?: string;
    replyPreview?: ReplyPreview;
};

export type Message = MessageMetadata &
    (
        | (SentMessageMetadata & {
              kind: 'text';
              text: string;
          })
        | { kind: 'reaction_log'; fragment: string }
        | { kind: 'activity'; text: string }
        | (SentMessageMetadata & {
              kind: 'reel_share';
              mediaType: 'reel' | 'post';
              shortcode: string;
              mediaId?: string;
              targetUrl: string;
              thumbUrl: string;
              previewWidth?: number;
              previewHeight?: number;
              author: string;
              caption?: string;
          })
        | (SentMessageMetadata & {
              kind: 'inline_share';
              targetUrl?: string;
              thumbUrl: string;
              title: string;
              subtitle?: string;
          })
        | (SentMessageMetadata & {
              kind: 'image';
              images: MessageImage[];
          })
        | (SentMessageMetadata & {
              kind: 'unsupported';
              contentType: string;
              fallback: MessageFallback;
          })
    );

export type ReplyPreview =
    | { kind: 'text'; text: string }
    | { kind: 'media'; title: string; thumbUrl?: string; subtitle?: string }
    | { kind: 'unavailable'; label: string };

export type Thread = {
    key: string;
    /** Small operation ID from `thread_fbid`, or captured `thread_igid`/composer `id`. */
    threadFbid?: string;
    /** Large read-receipt identifier sourced exclusively from Instagram's `thread_id`. */
    threadIgId?: string;
    title: string;
    isGroup: boolean;
    isMuted: boolean;
    folder: Folder;
    lastActivityMs: number;
    serverIsPin: boolean;
    serverPinnedMessageIds?: string[];
    users: User[];
    lastMessage?: Message;
    cursor?: string;
};
export type ReelMediaItem = {
    id: string;
    width: number;
    height: number;
    posterUrl: string;
    canDownload: boolean;
    downloadUrl?: string;
} & (
    | { kind: 'image'; imageUrl: string }
    | {
        kind: 'video';
        videoUrl: string;
        variants: Array<{
            url: string;
            type?: number;
            width?: number;
            height?: number;
            bandwidth?: number;
        }>;
        durationSec: number;
    }
);
export type ReelAuthor = User & { isVerified: boolean };
export type AttachedAudio = {
    id: string;
    url: string;
    title?: string;
    artist?: string;
    durationSec: number;
    startTimeSec: number;
    playDurationSec?: number;
};
export type ReelMedia = {
    id: string;
    shortcode: string;
    mediaType: 'reel' | 'post';
    author: ReelAuthor;
    caption?: string;
    takenAtMs?: number;
    items: ReelMediaItem[];
    likeCount: number;
    commentCount: number;
    hasLiked: boolean;
    hasSaved: boolean;
    canSave: boolean;
    canDownload: boolean;
    attachedAudio?: AttachedAudio;
};
export type ReelComment = {
    id: string;
    text: string;
    createdAtMs: number;
    likeCount: number;
    hasLiked: boolean;
    childCommentCount: number;
    author: ReelAuthor;
};
export type ReelComments = Page<ReelComment>;
export type ReelLikeReceipt = { mediaId: string; hasLiked: boolean };
export type ReelSaveReceipt = { mediaId: string; hasSaved: boolean };
export type Page<T> = { items: T[]; cursor?: string; hasNextPage: boolean };
export type ThreadMessages = Page<Message> & {
    thread?: Thread;
    viewerId: string;
};

/** Protocol-neutral authoritative DM data used by the UI reconciliation boundary. */
export type IncomingDmSnapshot = {
    kind: 'snapshot';
    threads: Thread[];
    history?: {
        threadId: string;
        messages: Message[];
        viewerId: string;
    };
};

export type ApiError = { message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type MessageRequestFolder = 'REQUESTS' | 'SPAM';
export type ThreadInfo = Pick<
    Thread,
    | 'key'
    | 'threadFbid'
    | 'threadIgId'
    | 'title'
    | 'isGroup'
    | 'isMuted'
    | 'serverIsPin'
    | 'users'
>;
export type MessageActions = {
    canCopy: boolean;
    canReply: boolean;
    canReact: boolean;
    canUnsend: boolean;
    canPin: boolean;
    isPinned: boolean;
};
export type UnreadCount = {
    countedTotal: number;
    inbox: { count: number; hasMore: boolean };
    requests: { count: number; hasMore: boolean };
    spam: { count: number; hasMore: boolean };
};
export type SentMessage = {
    messageId: string;
    timestampMs?: number;
    clientRequestId: string;
};
export type SentTextMessage = SentMessage & { timestampMs: number };
export type SetReactionResult = {
    messageId: string;
    reactions: MessageReaction[];
};
export type MutationSuccess = { success: true };
export type PinMessageResult = { pinnedMessageIds: string[] };
export type PinThreadResult = { threadFbid: string; isPinned: boolean };

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type InstagramGraphqlPayload = {
    data?: { [key: string]: JsonValue };
    errors?: { message: string; code?: string }[];
};

export type InstagramSecondaryGraphqlRequest =
    | { operation: 'PolarisAutomaticPreviewsDisabledContextProviderQuery' }
    | { operation: 'useFeatureLimitsOffMsysQuery' }
    | { operation: 'IGPresenceUnifiedSetupQuery' }
    | { operation: 'IGDInboxTrayQuery' }
    | { operation: 'IGDEmojiPickerQuery' }
    | { operation: 'IGDComposerRichContentTray_AvatarAvailableQuery' }
    | {
          operation: 'IGDComposerRichContentStickersV2Query';
          searchQuery: string;
      }
    | { operation: 'IGDComposerRichContentStickersV2_recentStickersQuery' }
    | { operation: 'IGDComposerRichContentStickersV2_cutoutStickersQuery' }
    | {
          operation: 'IGDComposerRichContentStickersV2ThreadIGIDQuery';
          threadFbid: string;
      }
    | { operation: 'IGDComposerRichContentMusicQuery'; playlistId: string }
    | { operation: 'IGDComposerRichContentMusicSearchQuery'; query: string }
    | {
          operation: 'useIGDSystemFolderUnreadThreadCountQuery';
          folder: 'INBOX' | 'PENDING';
          newerThanTimestampMs?: string;
      }
    | {
          operation: 'IGDComposerRichContentMusicThreadIGIDQuery';
          threadFbid: string;
      }
    | {
          operation: 'playlistMusicRefetchQuery';
          playlistId: string;
          cursor: string;
          count?: number;
      };

export type InstagramSecondaryGraphqlResult =
    | {
          operation: 'IGDEmojiPickerQuery';
          categories: { id: string; name: string; items: string[] }[];
      }
    | {
          operation:
              | 'IGDComposerRichContentStickersV2Query'
              | 'IGDComposerRichContentStickersV2_recentStickersQuery'
              | 'IGDComposerRichContentStickersV2_cutoutStickersQuery';
          sections: {
              id: string;
              title: string;
              type?: string;
              items: {
                  id: string;
                  altText: string;
                  sendType?: string;
                  image?: {
                      url: string;
                      width: number;
                      height: number;
                      animated: boolean;
                  };
              }[];
          }[];
      }
    | {
          operation:
              | 'IGDComposerRichContentMusicQuery'
              | 'IGDComposerRichContentMusicSearchQuery'
              | 'playlistMusicRefetchQuery';
          tracks: {
              id: string;
              title: string;
              artist: string;
              durationMs: number;
              artworkUrl?: string;
              previewUrl?: string;
          }[];
          cursor?: string;
          hasNextPage: boolean;
      }
    | {
          operation: 'IGDComposerRichContentTray_AvatarAvailableQuery';
          available: boolean;
      }
    | {
          operation:
              | 'IGDComposerRichContentStickersV2ThreadIGIDQuery'
              | 'IGDComposerRichContentMusicThreadIGIDQuery';
          threadFbid?: string;
      }
    | {
          operation:
              | 'PolarisAutomaticPreviewsDisabledContextProviderQuery'
              | 'useFeatureLimitsOffMsysQuery'
              | 'IGPresenceUnifiedSetupQuery'
              | 'IGDInboxTrayQuery'
              | 'useIGDSystemFolderUnreadThreadCountQuery';
          payload: InstagramGraphqlPayload;
      };

export type CoreRpcMap = {
    getInbox: (payload: { cursor?: string }) => Result<Page<Thread>>;
    getThread: (payload: {
        threadKey: string;
        cursor?: string;
    }) => Result<ThreadMessages>;
    getReelMedia: (payload: {
        shortcode: string;
        mediaId?: string;
    }) => Result<ReelMedia>;
    getReelComments: (payload: {
        mediaId: string;
        cursor?: string;
    }) => Result<ReelComments>;
    setReelLiked: (payload: {
        mediaId: string;
        liked: boolean;
    }) => Result<ReelLikeReceipt>;
    setReelSaved: (payload: {
        mediaId: string;
        saved: boolean;
    }) => Result<ReelSaveReceipt>;
    getPins: () => { pinned: string[] };
    togglePin: (payload: {
        threadKey: string;
        threadFbid: string;
        pin: boolean;
    }) => Result<{ pinned: string[]; receipt: PinThreadResult }>;
};

/** Contracts implemented by the Instagram anchor as DM capabilities land. */
export type InstagramRpcMap = {
    getMessageRequests: (payload: {
        folder: MessageRequestFolder;
        cursor?: string;
    }) => Result<Page<Thread>>;
    getThreadInfo: (payload: { threadFbid: string }) => Result<ThreadInfo>;
    getMessageActions: (payload: {
        threadFbid: string;
        messageId: string;
        senderId: string;
    }) => Result<MessageActions>;
    getUnreadCount: () => Result<UnreadCount>;
    sendText: (payload: {
        threadFbid: string;
        text: string;
        replyToMessageId?: string;
        offlineThreadingId: string;
    }) => Result<SentTextMessage>;
    setReaction: (payload: {
        threadFbid: string;
        messageId: string;
        emoji: string;
        remove: boolean;
    }) => Result<SetReactionResult>;
    togglePin: (payload: {
        threadKey: string;
        threadFbid: string;
        pin: boolean;
    }) => Result<{ pinned: string[]; receipt: PinThreadResult }>;
    markThreadRead: (payload: {
        threadIgId: string;
        messageId: string;
        messageTimestampMs: number;
    }) => Result<MutationSuccess>;
    pinMessage: (payload: {
        threadFbid: string;
        messageId: string;
        replaceOldest?: boolean;
    }) => Result<PinMessageResult>;
    sendCutoutSticker: (payload: {
        threadFbid: string;
        stickerId: string;
        replyToMessageId?: string;
        clientRequestId: string;
    }) => Result<SentMessage>;
    executeInstagramGraphql: (
        payload: InstagramSecondaryGraphqlRequest,
    ) => Result<InstagramSecondaryGraphqlResult>;
};

/** Capabilities exposed to the extension UI and routed through the background. */
export type RpcMap = CoreRpcMap &
    Pick<InstagramRpcMap, 'sendText' | 'setReaction'>;
