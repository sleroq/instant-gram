import type { Message, User } from '../domain.ts';
import { InboxError, type InboxData, type InboxRepository, type ThreadFact } from './inbox.ts';

const DB_NAME = 'icr-successor';
type Stored<T> = { accountId: string; id: string; value: T };

export function createInboxRepository(factory: IDBFactory = globalThis.indexedDB): InboxRepository {
    let opened: Promise<IDBDatabase> | undefined;
    function open(): Promise<IDBDatabase> {
        if (opened) return opened;
        const opening = new Promise<IDBDatabase>((resolve, reject) => {
            const request = factory.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of ['users', 'threads', 'messages']) {
                    const store = db.createObjectStore(name, { keyPath: ['accountId', 'id'] });
                    store.createIndex('accountId', 'accountId');
                }
                db.createObjectStore('resources', { keyPath: ['accountId', 'id'] }).createIndex('accountId', 'accountId');
                db.createObjectStore('meta');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new InboxError('storage'));
        }).catch((): never => {
            opened = undefined;
            throw new InboxError('storage');
        });
        opened = opening;
        return opening;
    }
    function requestResult<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new InboxError('storage'));
        });
    }
    function completion(tx: IDBTransaction): Promise<void> {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(new InboxError('storage'));
            tx.onabort = () => reject(new InboxError('storage'));
        });
    }
    async function finish<T>(tx: IDBTransaction, work: Promise<T>, completed: Promise<void>): Promise<T> {
        const guardedWork = work.catch(error => {
            try { tx.abort(); } catch { /* The failed transaction may already be aborting. */ }
            throw error;
        });
        const [workResult, completionResult] = await Promise.allSettled([guardedWork, completed]);
        if (workResult.status === 'rejected' || completionResult.status === 'rejected') throw new InboxError('storage');
        return workResult.value;
    }
    async function facts<T>(store: IDBObjectStore, accountId: string): Promise<Stored<T>[]> {
        // SAFETY: the v1 store is private and every record is written as Stored<T> below.
        return requestResult(store.index('accountId').getAll(accountId)) as Promise<Stored<T>[]>;
    }
    return {
        async readInbox(accountId) {
            const db = await open();
            const tx = db.transaction(['users', 'threads', 'messages', 'resources', 'meta'], 'readonly');
            const completed = completion(tx);
            const work = Promise.all([
                facts<User>(tx.objectStore('users'), accountId),
                facts<ThreadFact>(tx.objectStore('threads'), accountId),
                facts<Message>(tx.objectStore('messages'), accountId),
                requestResult(tx.objectStore('resources').get([accountId, 'inbox:primary'])),
                requestResult(tx.objectStore('meta').get('revision')),
            ]).then(([users, threads, messages, rawResource, rawRevision]) => {
                const revision = Number(rawRevision ?? 0);
                if (!rawResource) return { data: null, revision };
                // SAFETY: resources are only created by the v1 writer below.
                const resource = rawResource as Stored<Omit<InboxData, 'usersById' | 'threadsById' | 'messagesById'>>;
                const data: InboxData = {
                    ...resource.value,
                    usersById: Object.fromEntries(users.map(item => [item.id, item.value])),
                    threadsById: Object.fromEntries(threads.map(item => [item.id, item.value])),
                    messagesById: Object.fromEntries(messages.map(item => [item.id, item.value])),
                };
                return { data, revision };
            });
            return finish(tx, work, completed);
        },
        async replaceInbox(accountId, data) {
            const db = await open();
            const tx = db.transaction(['users', 'threads', 'messages', 'resources', 'meta'], 'readwrite');
            const completed = completion(tx);
            const work = (async () => {
                for (const name of ['users', 'threads', 'messages', 'resources']) {
                    const store = tx.objectStore(name);
                    const keys = await requestResult(store.index('accountId').getAllKeys(accountId));
                    for (const key of keys) store.delete(key);
                }
                for (const [id, value] of Object.entries(data.usersById)) tx.objectStore('users').put({ accountId, id, value });
                for (const [id, value] of Object.entries(data.threadsById)) tx.objectStore('threads').put({ accountId, id, value });
                for (const [id, value] of Object.entries(data.messagesById)) tx.objectStore('messages').put({ accountId, id, value });
                const { usersById, threadsById, messagesById, ...resource } = data;
                tx.objectStore('resources').put({ accountId, id: 'inbox:primary', value: resource });
                const revision = Number(await requestResult(tx.objectStore('meta').get('revision')) ?? 0) + 1;
                tx.objectStore('meta').put(revision, 'revision');
                return revision;
            })();
            return finish(tx, work, completed);
        },
        async close() {
            if (opened) (await opened).close();
            opened = undefined;
        },
    };
}
