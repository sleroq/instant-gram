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
      }
    | { kind: 'reaction_log'; id: string; ts: number; fragment: string }
    | {
          kind: 'reel_share';
          id: string;
          senderId: string;
          ts: number;
          shortcode: string;
          targetUrl: string;
          thumbUrl: string;
          author: string;
          caption?: string;
      }
    | {
          kind: 'unsupported';
          id: string;
          senderId: string;
          ts: number;
          contentType: string;
      };

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
export type ThreadMessages = Page<Message> & { thread?: Thread; viewerId: string };

export type ApiError = { message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export type RpcMap = {
    getInbox: (payload: { cursor?: string }) => Result<Page<Thread>>;
    getThread: (payload: {
        threadKey: string;
        cursor?: string;
    }) => Result<ThreadMessages>;
    getReelMedia: (payload: { shortcode: string }) => Result<ReelMedia>;
    getPins: () => { pinned: string[] };
    togglePin: (payload: { threadKey: string }) => { pinned: string[] };
};
