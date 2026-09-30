import type browser from 'webextension-polyfill';
import type { Page, Thread, ThreadMessages } from '../domain.ts';
import { InboxError } from '../engine/resources.ts';
import { currentInstagramAccountId, harvestTokens } from '../ig-auth.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
    type ProviderResponse,
} from './protocol.ts';

type ReadDependencies = {
    account(): string;
    prepare(): Promise<void>;
    inbox(cursor?: string): Promise<Page<Thread>>;
    history(threadKey: string, cursor?: string): Promise<ThreadMessages>;
};

export async function executeInboxProviderRequest(
    request: ProviderRequest,
    dependencies: ReadDependencies,
): Promise<ProviderResponse> {
    let expected: string | undefined;
    function verify() {
        try {
            const current = dependencies.account();
            if (!current || (expected !== undefined && current !== expected))
                throw new InboxError('auth');
            return current;
        } catch {
            throw new InboxError('auth');
        }
    }
    try {
        expected = verify();
        if (request.method === 'account') {
            return {
                kind: 'response',
                id: request.id,
                method: 'account',
                result: { ok: true, value: expected },
            };
        }
        if (request.expectedAccountId !== expected)
            throw new InboxError('auth');
        await dependencies.prepare();
        verify();
        if (request.method === 'history') {
            const value = await dependencies.history(
                request.threadKey,
                request.cursor,
            );
            verify();
            return {
                kind: 'response',
                id: request.id,
                method: 'history',
                result: { ok: true, value },
            };
        }
        const value = await dependencies.inbox(request.cursor);
        verify();
        return {
            kind: 'response',
            id: request.id,
            method: 'inbox',
            result: { ok: true, value },
        };
    } catch (cause) {
        let error =
            cause instanceof InboxError ? cause : new InboxError('protocol');
        try {
            verify();
        } catch {
            error = new InboxError('auth');
        }
        return {
            kind: 'response',
            id: request.id,
            method: request.method,
            result: {
                ok: false,
                error: { kind: error.kind, message: error.message },
            },
        };
    }
}

export function registerInboxProvider(
    runtime: Pick<browser.Runtime.Static, 'connect'>,
    reads: Pick<ReadDependencies, 'inbox' | 'history'>,
) {
    function connect() {
        const port = runtime.connect({ name: PROVIDER_PORT });
        // SAFETY: the extension-owned provider Port receives its worker's closed ProviderRequest values.
        const receive = ((request: ProviderRequest) => {
            if (request.kind !== 'request') return;
            void executeInboxProviderRequest(request, {
                account: currentInstagramAccountId,
                prepare: async () => {
                    await harvestTokens(true);
                },
                inbox: reads.inbox,
                history: reads.history,
            }).then((response) => {
                try {
                    port.postMessage(response);
                } catch {
                    /* The requesting worker disconnected. */
                }
            });
        }) as Parameters<typeof port.onMessage.addListener>[0];
        port.onMessage.addListener(receive);
        port.onDisconnect.addListener(connect);
    }
    connect();
}
