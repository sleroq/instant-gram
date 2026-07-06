export type Folder = 'PRIMARY' | 'GENERAL' | 'REQUESTS';

export type User = {
    id: string;
    username: string;
    fullName: string;
    picUrl: string | null;
};

export type Message =
    | {
          kind: 'text';
          id: string;
          senderId: string;
          ts: number;
          text: string;
          repliedTo?: string;
          replyPreview?: ReplyPreview;
      }
    | { kind: 'reaction_log'; id: string; ts: number; fragment: string }
    | {
          kind: 'reel_share';
          id: string;
          senderId: string;
          ts: number;
          shortcode: string;
          mediaId?: string;
          targetUrl: string;
          thumbUrl: string;
          author: string;
          caption?: string;
          repliedTo?: string;
          replyPreview?: ReplyPreview;
      }
    | {
          kind: 'inline_share';
          id: string;
          senderId: string;
          ts: number;
          targetUrl?: string;
          thumbUrl: string;
          title: string;
          subtitle?: string;
          repliedTo?: string;
          replyPreview?: ReplyPreview;
      }
    | {
          kind: 'unsupported';
          id: string;
          senderId: string;
          ts: number;
          contentType: string;
          repliedTo?: string;
          replyPreview?: ReplyPreview;
      };

export type ReplyPreview =
    | { kind: 'text'; text: string }
    | { kind: 'media'; title: string; thumbUrl?: string; subtitle?: string }
    | { kind: 'unavailable'; label: string };

export type Thread = {
    key: string;
    title: string;
    isGroup: boolean;
    isMuted: boolean;
    folder: Folder;
    lastActivityMs: number;
    serverIsPin: boolean;
    users: User[];
    lastMessage?: Message;
    cursor?: string;
};
export type ReelMedia = {
    shortcode: string;
    videoUrl: string;
    durationSec: number;
    owner: string;
};
export type Page<T> = { items: T[]; cursor?: string; hasNextPage: boolean };
export type ThreadMessages = Page<Message> & {
    thread?: Thread;
    viewerId: string;
};

export type ApiError = { message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type RpcMap = {
    getInbox: (payload: { cursor?: string }) => Result<Page<Thread>>;
    getThread: (payload: {
        threadKey: string;
        cursor?: string;
    }) => Result<ThreadMessages>;
    getReelMedia: (payload: {
        shortcode: string;
        mediaId?: string;
    }) => Result<ReelMedia>;
    getPins: () => { pinned: string[] };
    togglePin: (payload: { threadKey: string }) => { pinned: string[] };
};
