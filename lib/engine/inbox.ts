import type { Message, Page, Thread, User } from '../domain.ts';

export type InboxErrorKind = 'auth' | 'provider_unavailable' | 'protocol' | 'storage';
export type EngineError = { kind: InboxErrorKind; message: string };
const MESSAGES = {
    auth: 'Instagram authentication is unavailable.',
    provider_unavailable: 'Instagram provider is unavailable.',
    protocol: 'Instagram inbox could not be loaded.',
    storage: 'Saved inbox data is unavailable.',
} satisfies Record<InboxErrorKind, string>;
export class InboxError extends Error {
    readonly kind: InboxErrorKind;
    constructor(kind: InboxErrorKind) {
        super(MESSAGES[kind]);
        this.kind = kind;
    }
}

export type ThreadFact = Omit<Thread, 'users' | 'lastMessage'> & { userIds: string[]; lastMessageId?: string };
export type InboxData = {
    orderedIds: string[];
    threadsById: Record<string, ThreadFact>;
    usersById: Record<string, User>;
    messagesById: Record<string, Message>;
    fetchedAt: number;
    cursor?: string;
    hasNextPage: boolean;
};
export type InboxProjection = {
    accountId: string | null;
    accountEpoch: number;
    workerEpoch: string;
    commitRevision: number;
    availability: 'absent' | 'present';
    freshness: 'fresh' | 'stale';
    synchronization: 'idle' | 'refreshing' | 'error';
    error?: EngineError;
    inbox: InboxData | null;
};
export interface InboxRepository {
    readInbox(accountId: string): Promise<{ data: InboxData | null; revision: number }>;
    replaceInbox(accountId: string, data: InboxData): Promise<number>;
    close(): Promise<void>;
}
export interface InboxProvider {
    account(): Promise<string>;
    inbox(expectedAccountId: string): Promise<Page<Thread>>;
}
export type InboxEngine = {
    subscribe(listener: (value: InboxProjection) => void): () => void;
    refresh(): Promise<void>;
    snapshot(): InboxProjection;
};

export function normalizeInbox(page: Page<Thread>, fetchedAt = Date.now()): InboxData {
    const orderedIds: string[] = [];
    const threadsById: Record<string, ThreadFact> = {};
    const usersById: Record<string, User> = {};
    const messagesById: Record<string, Message> = {};
    const seen = new Set<string>();
    for (const thread of page.items) {
        if (!seen.has(thread.key)) {
            seen.add(thread.key);
            orderedIds.push(thread.key);
        }
        for (const user of thread.users) usersById[user.id] = user;
        if (thread.lastMessage) messagesById[thread.lastMessage.id] = thread.lastMessage;
        const { users, lastMessage, ...fact } = thread;
        const threadFact: ThreadFact = { ...fact, userIds: users.map(user => user.id) };
        if (lastMessage) threadFact.lastMessageId = lastMessage.id;
        threadsById[thread.key] = threadFact;
    }
    const inbox: InboxData = { orderedIds, threadsById, usersById, messagesById, fetchedAt, hasNextPage: page.hasNextPage };
    if (page.cursor) inbox.cursor = page.cursor;
    return inbox;
}

function publicError(cause: unknown, fallback: InboxErrorKind): EngineError {
    const known = cause instanceof InboxError ? cause : new InboxError(fallback);
    return { kind: known.kind, message: known.message };
}

export function createInboxEngine(repository: InboxRepository, provider: InboxProvider): InboxEngine {
    const listeners = new Set<(value: InboxProjection) => void>();
    let flight: Promise<void> | undefined;
    let identityVerified = false;
    let state: InboxProjection = {
        accountId: null, accountEpoch: 0, workerEpoch: crypto.randomUUID(), commitRevision: 0,
        availability: 'absent', freshness: 'stale', synchronization: 'idle', inbox: null,
    };
    function publish(patch: Partial<InboxProjection>) {
        state = { ...state, ...patch };
        for (const listener of listeners) listener(state);
    }
    function clear(error: EngineError) {
        identityVerified = false;
        publish({ accountId: null, accountEpoch: state.accountEpoch + 1, inbox: null,
            availability: 'absent', freshness: 'stale', synchronization: 'error', error });
    }
    async function run() {
        identityVerified = false;
        let accountId: string;
        try {
            accountId = await provider.account();
        } catch (error) {
            clear(publicError(error, 'auth'));
            return;
        }
        identityVerified = true;
        if (accountId !== state.accountId) {
            publish({ accountId, accountEpoch: state.accountEpoch + 1, inbox: null,
                availability: 'absent', freshness: 'stale', synchronization: 'refreshing', error: undefined });
            try {
                const cached = await repository.readInbox(accountId);
                if (cached.data) publish({ inbox: cached.data, commitRevision: cached.revision,
                    availability: 'present', freshness: 'stale', synchronization: 'refreshing' });
            } catch (error) {
                publish({ synchronization: 'error', error: publicError(error, 'storage') });
                return;
            }
        } else {
            publish({ freshness: 'stale', synchronization: 'refreshing', error: undefined });
        }
        let inbox: InboxData;
        try {
            inbox = normalizeInbox(await provider.inbox(accountId));
        } catch (error) {
            const classified = publicError(error, 'protocol');
            if (classified.kind === 'auth') clear(classified);
            else publish({ freshness: 'stale', synchronization: 'error', error: classified });
            return;
        }
        try {
            const commitRevision = await repository.replaceInbox(accountId, inbox);
            publish({ inbox, commitRevision, availability: 'present', freshness: 'fresh', synchronization: 'idle' });
        } catch (error) {
            publish({ freshness: 'stale', synchronization: 'error', error: publicError(error, 'storage') });
        }
    }
    function refresh() {
        if (!flight) flight = run().finally(() => { flight = undefined; });
        return flight;
    }
    function subscribe(listener: (value: InboxProjection) => void) {
        listeners.add(listener);
        void refresh();
        if (identityVerified) listener(state);
        else listener({ ...state, accountId: null, inbox: null, availability: 'absent', freshness: 'stale', synchronization: 'refreshing', error: undefined });
        return () => listeners.delete(listener);
    }
    return { subscribe, refresh, snapshot: () => state };
}
