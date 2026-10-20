import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Result } from 'effect';
import { makeInboxProvider } from '../lib/provider/inbox.ts';
import { executeInboxProviderRequest } from '../lib/provider/inbox-content.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
    type ProviderResponse,
} from '../lib/provider/protocol.ts';

type Listener<T> = (value: T) => void;
function fakePort(tabId: number) {
    const messages: Listener<ProviderResponse>[] = [];
    const disconnects: Array<() => void> = [];
    const sent: ProviderRequest[] = [];

    const value = {
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/direct/inbox/',
            tab: { id: tabId },
        },
        onMessage: {
            addListener(listener: Listener<ProviderResponse>) {
                messages.push(listener);
            },
            removeListener(listener: Listener<ProviderResponse>) {
                const index = messages.indexOf(listener);
                if (index >= 0) messages.splice(index, 1);
            },
        },
        onDisconnect: {
            addListener(listener: () => void) {
                disconnects.push(listener);
            },
            removeListener(listener: () => void) {
                const index = disconnects.indexOf(listener);
                if (index >= 0) disconnects.splice(index, 1);
            },
        },
        postMessage(message: ProviderRequest) {
            sent.push(message);
        },
        disconnect() {
            for (const listener of disconnects) listener();
        },
    };

    return {
        value,
        sent,
        reply(response: ProviderResponse) {
            for (const listener of messages) listener(response);
        },
    };
}

test('provider waits for the selected tab and ignores unrelated tab disconnects', async (t) => {
    let selected = 1;
    const provider = makeInboxProvider({
        ensureAnchor: async () => selected,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    const account = Effect.runPromise(provider.account);
    const unrelated = fakePort(2);
    provider.accept(unrelated.value);
    unrelated.value.disconnect();
    const selectedPort = fakePort(1);
    provider.accept(selectedPort.value);
    await new Promise((resolve) => setImmediate(resolve));
    const request = selectedPort.sent[0];
    assert.equal(request.method, 'account');
    selectedPort.reply({
        kind: 'response',
        id: request.id,
        method: 'account',
        result: { ok: true, value: '10' },
    });
    assert.equal(await account, '10');

    selected = 2;
    const secondPort = fakePort(2);
    provider.accept(secondPort.value);
    const inbox = Effect.runPromise(provider.inbox('20'));
    await new Promise((resolve) => setImmediate(resolve));
    const inboxRequest = secondPort.sent[0];
    assert.equal(inboxRequest.method, 'inbox');
    selectedPort.value.disconnect();
    secondPort.reply({
        kind: 'response',
        id: inboxRequest.id,
        method: 'inbox',
        result: { ok: true, value: { items: [], hasNextPage: false } },
    });
    assert.deepEqual(await inbox, { items: [], hasNextPage: false });
});

test('replacement retires pending requests and stale responses cannot affect the replacement', async (t) => {
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    const oldPort = fakePort(1);
    provider.accept(oldPort.value);
    const oldRequest = Effect.runPromise(Effect.result(provider.account));
    await new Promise((resolve) => setImmediate(resolve));
    const replacement = fakePort(1);
    provider.accept(replacement.value);
    const retired = await oldRequest;
    assert(Result.isFailure(retired));
    assert.equal(retired.failure.kind, 'provider_unavailable');
    const nextRequest = Effect.runPromise(provider.account);
    await new Promise((resolve) => setImmediate(resolve));
    oldPort.reply({
        kind: 'response',
        id: oldPort.sent[0].id,
        method: 'account',
        result: { ok: true, value: 'old' },
    });
    const request = replacement.sent[0];
    replacement.reply({
        kind: 'response',
        id: request.id,
        method: 'account',
        result: { ok: true, value: 'new' },
    });
    assert.equal(await nextRequest, 'new');
});

test('synchronous post failure rejects immediately as provider unavailable', async (t) => {
    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    const port = fakePort(1);
    port.value.postMessage = () => {
        throw new Error('closed');
    };
    provider.accept(port.value);
    const failed = await Effect.runPromise(Effect.result(provider.account));
    assert(Result.isFailure(failed));
    assert.equal(failed.failure.kind, 'provider_unavailable');
});

test('content execution preserves the account identity boundary', async () => {
    const inboxRequest = {
        kind: 'request',
        id: 1,
        method: 'inbox',
        expectedAccountId: '1',
    } as const;

    for (const account of [
        () => {
            throw new Error('missing');
        },
        () => '2',
    ]) {
        let reads = 0;
        const response = await executeInboxProviderRequest(inboxRequest, {
            account,
            mutate: async () => {
                throw new Error('unused');
            },
            prepare: async () => undefined,
            history: async () => ({
                items: [],
                hasNextPage: false,
                viewerId: '1',
            }),
            inbox: async () => {
                reads++;
                return { items: [], hasNextPage: false };
            },
        });
        assert.equal(response.result.ok, false);
        assert.equal(
            response.result.ok ? undefined : response.result.error.kind,
            'auth',
        );
        assert.equal(reads, 0);
    }

    for (const after of ['2', undefined]) {
        let checks = 0;

        const response = await executeInboxProviderRequest(inboxRequest, {
            account: () => {
                checks++;
                if (checks === 1) return '1';
                if (after) return after;
                throw new Error('gone');
            },
            mutate: async () => {
                throw new Error('unused');
            },
            prepare: async () => undefined,
            history: async () => ({
                items: [],
                hasNextPage: false,
                viewerId: '1',
            }),
            inbox: async () => ({ items: [], hasNextPage: false }),
        });
        assert.equal(
            response.result.ok ? undefined : response.result.error.kind,
            'auth',
        );
    }
});

test('content execution classifies failed reads and returns only parsed first-page data', async () => {
    for (const changed of [false, true]) {
        let checks = 0;

        const response = await executeInboxProviderRequest(
            { kind: 'request', id: 1, method: 'inbox', expectedAccountId: '1' },
            {
                account: () => (++checks > 1 && changed ? '2' : '1'),
                mutate: async () => {
                    throw new Error('unused');
                },
                prepare: async () => undefined,
                history: async () => ({
                    items: [],
                    hasNextPage: false,
                    viewerId: '1',
                }),
                inbox: async () => {
                    throw new Error('read');
                },
            },
        );
        assert.equal(
            response.result.ok ? undefined : response.result.error.kind,
            changed ? 'auth' : 'protocol',
        );
    }

    const page = { items: [], hasNextPage: false, cursor: 'next' };
    const response = await executeInboxProviderRequest(
        { kind: 'request', id: 2, method: 'inbox', expectedAccountId: '1' },
        {
            account: () => '1',
            mutate: async () => {
                throw new Error('unused');
            },
            prepare: async () => undefined,
            history: async () => ({
                items: [],
                hasNextPage: false,
                viewerId: '1',
            }),
            inbox: async () => page,
        },
    );
    assert.deepEqual(response.result, { ok: true, value: page });
});

test('closed history and pagination requests verify account before reading', async () => {
    let reads = 0;
    const mismatch = await executeInboxProviderRequest(
        {
            kind: 'request',
            id: 3,
            method: 'history',
            expectedAccountId: '1',
            threadKey: 't',
            cursor: 'c',
        },
        {
            account: () => '2',
            mutate: async () => {
                throw new Error('unused');
            },
            prepare: async () => undefined,
            inbox: async () => ({ items: [], hasNextPage: false }),
            history: async () => {
                reads++;
                return { items: [], hasNextPage: false, viewerId: '2' };
            },
        },
    );
    assert.equal(mismatch.result.ok, false);
    assert.equal(reads, 0);
});
