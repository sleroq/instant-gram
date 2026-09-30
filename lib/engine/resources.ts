import type { Message, Thread, User } from '../domain.ts';
import { Schema } from 'effect';

export type InboxErrorKind =
    | 'auth'
    | 'provider_unavailable'
    | 'protocol'
    | 'storage'
    | 'no_progress'
    | 'capacity';

export type EngineError = { kind: InboxErrorKind; message: string };

const MESSAGES = {
    auth: 'Instagram authentication is unavailable.',
    provider_unavailable: 'Instagram provider is unavailable.',
    protocol: 'Instagram conversations could not be loaded.',
    storage: 'Saved conversation data is unavailable.',
    no_progress: 'Instagram returned no older conversations or messages.',
    capacity: 'Conversation retention capacity has been reached.',
} satisfies Record<InboxErrorKind, string>;

export class InboxError extends Schema.TaggedError<InboxError>()('InboxError', {
    kind: Schema.Literals([
        'auth',
        'provider_unavailable',
        'protocol',
        'storage',
        'no_progress',
        'capacity',
    ]),
    message: Schema.String,
}) {
    constructor(kind: InboxErrorKind) {
        super({ kind, message: MESSAGES[kind] });
        this.name = 'Error';
    }
}

export type ThreadFact = Omit<Thread, 'users' | 'lastMessage'> & {
    userIds: string[];
    lastMessageId?: string;
};

export type EntityFacts = {
    threadsById: Record<string, ThreadFact>;
    usersById: Record<string, User>;
    messagesById: Record<string, Message>;
};

export type ResourceProjection = {
    orderedIds: string[];
    fetchedAt: number;
    cursor?: string;
    hasNextPage: boolean;
    availability: 'absent' | 'present';
    freshness: 'fresh' | 'stale';
    synchronization: 'idle' | 'refreshing' | 'error';
    error?: EngineError;
    retentionLimited?: boolean;
    failedOperation?: 'refresh' | 'continuation';
};

export type HistoryProjection = ResourceProjection & {
    threadId: string;
    viewerId?: string;
};

export type InboxProjection = {
    accountId: string | null;
    accountEpoch: number;
    workerEpoch: string;
    commitRevision: number;
    entities: EntityFacts;
    inbox: ResourceProjection;
    histories: Record<string, HistoryProjection>;
};

export type PersistedResource = ResourceProjection & {
    key: string;
    threadId?: string;
    viewerId?: string;
    /** The cursor used to request this segment. A head has no request cursor. */
    requestCursor?: string;
    refs: { threadIds: string[]; userIds: string[]; messageIds: string[] };
};

export type RepositoryRead = {
    resources: PersistedResource[];
    entities: EntityFacts;
    revision: number;
};

export type ResourceCommit = {
    resources: PersistedResource[];
    entities: EntityFacts;
    deleteKeys?: string[];
};

export interface InboxRepository {
    readResources(accountId: string, keys: string[]): Promise<RepositoryRead>;
    commitResources(
        accountId: string,
        update: ResourceCommit,
    ): Promise<RepositoryRead>;
    close(): Promise<void>;
}

export function emptyEntities(): EntityFacts {
    return { threadsById: {}, usersById: {}, messagesById: {} };
}

export function emptyResource(): ResourceProjection {
    return {
        orderedIds: [],
        fetchedAt: 0,
        hasNextPage: false,
        availability: 'absent',
        freshness: 'stale',
        synchronization: 'idle',
    };
}
