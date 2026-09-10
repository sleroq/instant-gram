import type browser from 'webextension-polyfill';
import type { Page, Thread } from '../domain.ts';
import type { InboxErrorKind } from '../engine/inbox.ts';
import { currentInstagramAccountId, harvestTokens } from '../ig-auth.ts';
import { PROVIDER_PORT, type ProviderRequest, type ProviderResponse } from './protocol.ts';

function failure(kind: InboxErrorKind) {
    const messages = {
        auth: 'Instagram authentication is unavailable.', provider_unavailable: 'Instagram provider is unavailable.',
        protocol: 'Instagram inbox request failed.', storage: 'Saved inbox data is unavailable.',
    } satisfies Record<InboxErrorKind, string>;
    return { ok: false as const, error: { kind, message: messages[kind] } };
}
export async function executeInboxProviderRequest(
    request: ProviderRequest,
    dependencies: { account(): string; prepare(): Promise<void>; inbox(): Promise<Page<Thread>> },
): Promise<ProviderResponse> {
    let accountId: string;
    try { accountId = dependencies.account(); }
    catch { return { kind: 'response', id: request.id, method: request.method, result: failure('auth') }; }
    if (request.method === 'account') return { kind: 'response', id: request.id, method: 'account', result: { ok: true, value: accountId } };
    if (request.expectedAccountId !== accountId) return { kind: 'response', id: request.id, method: 'inbox', result: failure('auth') };
    let page: Page<Thread>;
    try {
        await dependencies.prepare();
        page = await dependencies.inbox();
    } catch {
        try {
            if (dependencies.account() !== accountId)
                return { kind: 'response', id: request.id, method: 'inbox', result: failure('auth') };
        }
        catch { return { kind: 'response', id: request.id, method: 'inbox', result: failure('auth') }; }
        return { kind: 'response', id: request.id, method: 'inbox', result: failure('protocol') };
    }
    try {
        if (dependencies.account() !== accountId) return { kind: 'response', id: request.id, method: 'inbox', result: failure('auth') };
    } catch {
        return { kind: 'response', id: request.id, method: 'inbox', result: failure('auth') };
    }
    return { kind: 'response', id: request.id, method: 'inbox', result: { ok: true, value: page } };
}
export function registerInboxProvider(getInbox: () => Promise<Page<Thread>>, runtime: Pick<browser.Runtime.Static, 'connect'>) {
    function connect() {
        const port = runtime.connect({ name: PROVIDER_PORT });
        port.onMessage.addListener((request: ProviderRequest) => {
            if (request.kind !== 'request') return;
            void executeInboxProviderRequest(request, {
                account: currentInstagramAccountId,
                prepare: async () => { await harvestTokens(true); },
                inbox: getInbox,
            }).then(response => {
                try { port.postMessage(response); } catch { /* The validated provider port disconnected before delivery. */ }
            });
        });
        port.onDisconnect.addListener(connect);
    }
    connect();
}
