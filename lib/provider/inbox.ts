import type { Page, Thread, ThreadMessages } from '../domain.ts';
import { InboxError, type InboxProvider } from '../engine/inbox.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
    type ProviderResponse,
} from './protocol.ts';

export type ProviderPort = {
    name: string;
    sender?: {
        id?: string;
        frameId?: number;
        url?: string;
        tab?: { id?: number };
    };
    onMessage: {
        addListener(listener: (message: ProviderResponse) => void): void;
    };
    onDisconnect: { addListener(listener: () => void): void };
    postMessage(message: ProviderRequest): void;
    disconnect(): void;
};
type Pending = {
    method: 'account' | 'inbox' | 'history';
    resolve(value: string | Page<Thread> | ThreadMessages): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
};
type Connection = { port: ProviderPort; pending: Map<number, Pending> };

export function createInboxProvider(options: {
    ensureAnchor(): Promise<number>;
    extensionId: string;
}): InboxProvider & { accept(port: ProviderPort): void } {
    const connections = new Map<number, Connection>();
    const waiters = new Map<number, Set<() => void>>();
    let nextId = 0;
    function retire(connection: Connection) {
        for (const pending of connection.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new InboxError('provider_unavailable'));
        }
        connection.pending.clear();
    }
    function accept(port: ProviderPort) {
        const tabId = port.sender?.tab?.id;
        const url = port.sender?.url ? new URL(port.sender.url) : undefined;
        if (
            port.name !== PROVIDER_PORT ||
            port.sender?.id !== options.extensionId ||
            port.sender?.frameId !== 0 ||
            !Number.isInteger(tabId) ||
            tabId === undefined ||
            url?.origin !== 'https://www.instagram.com'
        ) {
            port.disconnect();
            return;
        }
        const connection: Connection = { port, pending: new Map() };
        const previous = connections.get(tabId);
        if (previous) {
            retire(previous);
            previous.port.disconnect();
        }
        connections.set(tabId, connection);
        for (const ready of waiters.get(tabId) ?? []) ready();
        waiters.delete(tabId);
        port.onMessage.addListener((response: ProviderResponse) => {
            if (response.kind !== 'response') return;
            const pending = connection.pending.get(response.id);
            if (!pending || pending.method !== response.method) return;
            connection.pending.delete(response.id);
            clearTimeout(pending.timer);
            if (response.result.ok) pending.resolve(response.result.value);
            else pending.reject(new InboxError(response.result.error.kind));
        });
        port.onDisconnect.addListener(() => {
            if (connections.get(tabId) === connection)
                connections.delete(tabId);
            retire(connection);
        });
    }
    async function connection(): Promise<Connection> {
        const tabId = await options.ensureAnchor();
        const existing = connections.get(tabId);
        if (existing) return existing;
        await new Promise<void>((resolve, reject) => {
            const set = waiters.get(tabId) ?? new Set();
            let timer: ReturnType<typeof setTimeout>;
            function ready() {
                clearTimeout(timer);
                set.delete(ready);
                resolve();
            }
            set.add(ready);
            waiters.set(tabId, set);
            timer = setTimeout(() => {
                set.delete(ready);
                if (!set.size) waiters.delete(tabId);
                reject(new InboxError('provider_unavailable'));
            }, 10_000);
        });
        const connected = connections.get(tabId);
        if (!connected) throw new InboxError('provider_unavailable');
        return connected;
    }
    function request(
        request: Extract<ProviderRequest, { method: 'account' }>,
    ): Promise<string>;
    function request(
        request: Extract<ProviderRequest, { method: 'inbox' }>,
    ): Promise<Page<Thread>>;
    function request(
        request: Extract<ProviderRequest, { method: 'history' }>,
    ): Promise<ThreadMessages>;
    async function request(
        request: ProviderRequest,
    ): Promise<string | Page<Thread> | ThreadMessages> {
        const connected = await connection();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                connected.pending.delete(request.id);
                reject(new InboxError('provider_unavailable'));
            }, 15_000);
            connected.pending.set(request.id, {
                method: request.method,
                resolve,
                reject,
                timer,
            });
            try {
                connected.port.postMessage(request);
            } catch {
                const pending = connected.pending.get(request.id);
                if (!pending) return;
                connected.pending.delete(request.id);
                clearTimeout(pending.timer);
                pending.reject(new InboxError('provider_unavailable'));
            }
        });
    }
    async function account() {
        return request({ kind: 'request', id: ++nextId, method: 'account' });
    }
    async function inbox(expectedAccountId: string, cursor?: string) {
        return request({
            kind: 'request',
            id: ++nextId,
            method: 'inbox',
            expectedAccountId,
            cursor,
        });
    }
    async function history(
        expectedAccountId: string,
        threadKey: string,
        cursor?: string,
    ) {
        return request({
            kind: 'request',
            id: ++nextId,
            method: 'history',
            expectedAccountId,
            threadKey,
            cursor,
        });
    }
    return { accept, account, inbox, history };
}
