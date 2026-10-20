import type { Message, Thread, User } from '../domain.ts';
import { Schema } from 'effect';
import type {
    MutationCommand,
    MutationRequest,
    Operation,
} from './operations.ts';

export type InboxErrorKind =
    | 'auth'
    | 'provider_unavailable'
    | 'protocol'
    | 'storage'
    | 'no_progress'
    | 'capacity'
    | 'invalid_request'
    | 'unknown_outcome'
    | 'rate_limited'
    | 'offline';

export type EngineError = { kind: InboxErrorKind; message: string };

const MESSAGES = {
    auth: 'Instagram authentication is unavailable.',
    provider_unavailable: 'Instagram provider is unavailable.',
    protocol: 'Instagram conversations could not be loaded.',
    storage: 'Saved conversation data is unavailable.',
    no_progress: 'Instagram returned no older conversations or messages.',
    capacity: 'Conversation retention capacity has been reached.',
    invalid_request: 'This action is no longer valid. Please try again.',
    unknown_outcome:
        'Instagram may have received this action. Refresh to check its current state.',
    rate_limited: 'Instagram is limiting requests. Please try again later.',
    offline: 'Instagram could not be reached.',
} satisfies Record<InboxErrorKind, string>;

export class InboxError extends Schema.TaggedError<InboxError>()('InboxError', {
    kind: Schema.Literals([
        'auth',
        'provider_unavailable',
        'protocol',
        'storage',
        'no_progress',
        'capacity',
        'invalid_request',
        'unknown_outcome',
        'rate_limited',
        'offline',
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
    pinOrder?: number;
    readWatermarkMs?: number;
    readWatermarkMessageId?: string;
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

export { HISTORY_WINDOW_LIMIT } from './projection-limits.ts';

export type HistoryProjection = ResourceProjection & {
    threadId: string;
    viewerId?: string;
    cachedOlder?: boolean;
    cachedNewer?: boolean;
    coverageGeneration?: number;
    newerCoverageAvailable?: boolean;
};

export type HistoryWindowRequest = {
    coverageGeneration?: number;
    anchorId?: string;
    direction?: 'at' | 'older' | 'newer';
};

export type HistoryWindowRead = {
    history?: HistoryProjection;
    entities: EntityFacts;
    revision: number;
};

export type HistoryInventory = {
    threadId: string;
    lastAccessedAt: number;
    segmentCount: number;
    retainedMessageCount: number;
    activeMessageCount: number;
};

export type InboxProjection = {
    accountId: string | null;
    accountEpoch: number;
    workerEpoch: string;
    commitRevision: number;
    entities: EntityFacts;
    inbox: ResourceProjection;
    histories: Record<string, HistoryProjection>;
    operations?: Operation[];
};

export type PersistedResource = ResourceProjection & {
    key: string;
    threadId?: string;
    viewerId?: string;
    /** The cursor used to request this segment. A head has no request cursor. */
    requestCursor?: string;
    /** Physical page storage and active-chain visitation metadata. */
    chunkCount?: number;
    activeGeneration?: number;
    refs: { threadIds: string[]; userIds: string[]; messageIds: string[] };
};

export type RepositoryRead = {
    resources: PersistedResource[];
    entities: EntityFacts;
    revision: number;
    deletedHistoryIds?: string[];
};

export type ResourceCommit = {
    resources: PersistedResource[];
    entities: EntityFacts;
    deleteKeys?: string[];
    returnKeys?: string[];
    retention?: {
        protectedThreadIds: string[];
        maxHistories: number;
        maxMessages: number;
    };
};

export interface InboxRepository {
    acceptOperation(
        command: MutationCommand,
        request: MutationRequest | undefined,
        createdAt: number,
    ): Promise<{ operation: Operation; revision: number }>;
    readOperations(accountId: string): Promise<{
        operations: Operation[];
        revision: number;
        entities: EntityFacts;
    }>;
    updateOperation(
        accountId: string,
        operation: Operation,
        update?: ResourceCommit,
    ): Promise<RepositoryRead & { operation: Operation }>;
    readResources(accountId: string, keys: string[]): Promise<RepositoryRead>;
    readHistoryWindow(
        accountId: string,
        threadId: string,
        request?: HistoryWindowRequest,
    ): Promise<HistoryWindowRead>;
    touchHistory(
        accountId: string,
        threadId: string,
        accessedAt: number,
    ): Promise<void>;
    readHistoryInventory(
        accountId: string,
        limit?: number,
    ): Promise<HistoryInventory[]>;
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
