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
    /** Stable local key aliases the provider ID after an accepted send. */
    serverId?: string;
    delivery?: {
        operationId: string;
        status: import('./engine/operations.ts').Operation['status'];
        retryable: boolean;
        error?: import('./engine/resources.ts').EngineError;
    };
    /** True only when `id` was synthesized because Instagram returned no message ID. */
    isSyntheticId?: true;
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
    isUnread: boolean;
    serverIsPin: boolean;
    serverPinnedMessageIds?: string[];
    users: User[];
    lastMessage?: Message;
    cursor?: string;
};
export type Page<T> = { items: T[]; cursor?: string; hasNextPage: boolean };
export type ThreadMessages = Page<Message> & {
    thread?: Thread;
    viewerId: string;
};
