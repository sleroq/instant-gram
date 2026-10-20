import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Fiber, Result } from 'effect';
import { TestClock } from 'effect/testing';
import type { MutationRequest } from '../lib/engine/operations.ts';
import { InboxError } from '../lib/engine/resources.ts';
import type { JsonValue } from '../lib/json.ts';
import { createInboxMutator } from '../lib/instagram-api/mutations.ts';
import { createInboxReader } from '../lib/instagram-api/inbox.ts';
import { executeInboxProviderRequest } from '../lib/provider/inbox-content.ts';
import {
    makeInboxProvider,
    type ProviderResponseInput,
} from '../lib/provider/inbox.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
} from '../lib/provider/protocol.ts';

const pin: MutationRequest = {
    intent: { type: 'pin', threadId: 'key', isPinned: true },
    threadFbid: 'fbid',
    offlineThreadingId: '123',
};
const send: MutationRequest = {
    intent: { type: 'send', threadId: 'key', text: 'hello', replyTo: 'reply' },
    threadFbid: 'fbid',
    viewerId: 'viewer',
    offlineThreadingId: '123',
};
const read: MutationRequest = {
    intent: {
        type: 'read',
        threadId: 'key',
        messageId: 'mid',
        timestampMs: 100,
    },
    threadIgId: 'large',
    viewerId: 'viewer',
    offlineThreadingId: '123',
};
const message = {
    kind: 'text' as const,
    id: 'sent',
    senderId: 'viewer',
    text: 'hello',
    repliedTo: 'reply',
    ts: 101,
};
const thread = {
    key: 'key',
    threadFbid: 'fbid',
    title: '',
    isGroup: false,
    isMuted: false,
    folder: 'PRIMARY' as const,
    lastActivityMs: 101,
    isUnread: false,
    serverIsPin: false,
    users: [],
};
function fails(kind: string) {
    return (error: unknown) =>
        error instanceof InboxError && error.kind === kind;
}

for (const isPinned of [true, false])
    test(`pin ${isPinned} validates exact id/state and descriptor`, async () => {
        const input = {
            ...pin,
            intent: { ...pin.intent, type: 'pin' as const, isPinned },
        };

        for (const [id, state, ok] of [
            ['fbid', isPinned, true],
            ['other', isPinned, false],
            ['fbid', !isPinned, false],
            ['fbid', null, false],
        ] as const) {
            const mutate = createInboxMutator({
                graphql: async (operation, variables, expected) => {
                    assert.equal(expected, 'account');
                    assert.equal(
                        operation.docId,
                        isPinned ? '26491513390471063' : '26719492947719993',
                    );
                    assert.deepEqual(variables, {
                        thread_fbid: 'fbid',
                        pin: isPinned,
                    });
                    return {
                        json: {
                            data: {
                                xig_direct_pin_thread: { id, is_pin: state },
                            },
                        },
                        viewerId: 'viewer',
                    };
                },
                history: async () => {
                    throw Error('unexpected history');
                },
            });
            if (ok)
                assert.deepEqual(await mutate('account', input), {
                    type: 'pin',
                    threadFbid: 'fbid',
                    isPinned,
                });
            else
                await assert.rejects(
                    mutate('account', input),
                    fails('unknown_outcome'),
                );
        }
    });

test('send/reply requires captured receipt and matching history echo, never fabricated authors', async () => {
    for (const mismatch of [
        'none',
        'author',
        'thread',
        'id',
        'text',
        'reply',
        'timestamp',
        'synthetic',
        'viewer',
        'missing',
    ] as const) {
        const mutate = createInboxMutator({
            graphql: async (operation, variables) => {
                assert.equal(operation.docId, '26911679871773184');

                assert.equal(variables.ig_thread_igid, 'fbid');
                assert.equal(variables.offline_threading_id, '123');
                assert.equal(variables.reply_to_message_id, 'reply');
                assert.deepEqual(variables.text, {
                    sensitive_string_value: 'hello',
                });
                return {
                    json: {
                        data: {
                            xig_direct_text_send_with_slide_messaging_response:
                                {
                                    id: 'sent',
                                    message_id: 'sent',
                                    timestamp_ms: '101',
                                },
                        },
                    },
                    viewerId: 'viewer',
                };
            },
            history: async () => ({
                viewerId: mismatch === 'viewer' ? 'other' : 'viewer',
                hasNextPage: false,
                thread: {
                    ...thread,
                    threadFbid: mismatch === 'thread' ? 'other' : 'fbid',
                },
                items:
                    mismatch === 'missing'
                        ? []
                        : [
                              {
                                  ...message,
                                  senderId:
                                      mismatch === 'author'
                                          ? 'other'
                                          : 'viewer',
                                  id: mismatch === 'id' ? 'other' : 'sent',
                                  text: mismatch === 'text' ? 'other' : 'hello',
                                  repliedTo:
                                      mismatch === 'reply' ? 'other' : 'reply',
                                  ts: mismatch === 'timestamp' ? 102 : 101,
                                  isSyntheticId:
                                      mismatch === 'synthetic'
                                          ? true
                                          : undefined,
                              },
                          ],
            }),
        });
        if (mismatch === 'none')
            assert.equal((await mutate('account', send)).type, 'send');
        else
            await assert.rejects(
                mutate('account', send),
                fails('unknown_outcome'),
            );
    }
});

test('paired reads validate BOTH receipts including captured false validation', async () => {
    for (const bad of [
        'none',
        'seen',
        'participant',
        'watermark',
        'validation',
    ] as const) {
        const calls: string[] = [];

        const mutate = createInboxMutator({
            graphql: async (operation, variables) => {
                calls.push(operation.docId);
                assert.deepEqual(variables.metadata, {
                    ig_thread_igid: 'large',
                });
                let json: JsonValue;
                if (operation.docId === '27356881703909995')
                    json = {
                        data: {
                            xig_direct_item_seen_mutation_with_slide_messaging_response:
                                bad === 'seen'
                                    ? null
                                    : {
                                          __typename: 'XFBSlideReadReceipt',
                                          participant_fbid:
                                              bad === 'participant'
                                                  ? 'other'
                                                  : 'actor',
                                          watermark_timestamp_ms:
                                              bad === 'watermark'
                                                  ? '99'
                                                  : '102',
                                      },
                        },
                    };
                else {
                    assert.deepEqual(variables.data, {
                        message_id: 'mid',
                        message_timestamp_ms: '100',
                    });
                    json = {
                        data: {
                            xig_direct_mark_read_id_validation:
                                bad === 'validation' ? null : false,
                        },
                    };
                }
                return { json, viewerId: 'actor' };
            },
            history: async () => {
                throw Error('unexpected');
            },
        });
        if (bad === 'none')
            assert.deepEqual(await mutate('account', read), {
                type: 'read',
                threadIgId: 'large',
                messageId: 'mid',
                timestampMs: 100,
            });
        else
            await assert.rejects(
                mutate('account', read),
                fails('unknown_outcome'),
            );
        assert.deepEqual(calls, ['27356881703909995', '35211594988486314']);
    }
});

test('content guards account before prepare, after prepare and after dispatch', async () => {
    for (const change of ['before', 'prepare', 'dispatch'] as const) {
        let account = change === 'before' ? 'other' : 'account';
        let calls = 0;
        const response = await executeInboxProviderRequest(
            {
                kind: 'request',
                id: 1,
                method: 'mutate',
                expectedAccountId: 'account',
                request: pin,
            },
            {
                account: () => account,
                prepare: async () => {
                    if (change === 'prepare') account = 'other';
                },
                mutate: async () => {
                    calls++;
                    account = 'other';
                    return { type: 'pin', threadFbid: 'fbid', isPinned: true };
                },
                inbox: async () => {
                    throw Error('unused');
                },
                history: async () => {
                    throw Error('unused');
                },
            },
        );
        assert.equal(calls, change === 'dispatch' ? 1 : 0);
        assert.equal(response.result.ok, false);
        if (!response.result.ok)
            assert.equal(
                response.result.error.kind,
                change === 'dispatch' ? 'unknown_outcome' : 'auth',
            );
    }
});

test('API validates before network; network/lost/malformed/status errors after dispatch are unknown', async () => {
    const tokens = {
        fbDtsg: '',
        lsd: '',
        jazoest: '',
        csrfToken: '',
        deviceId: '',
        viewerId: 'viewer',
    };

    for (const status of [0, 401, 403, 429, 500, 200]) {
        let calls = 0;
        const api = createInboxReader({
            account: () => 'account',
            tokens: async () => tokens,
            request: async () => {
                calls++;
                if (status === 0) throw Error('offline');
                return new Response('not-json', { status });
            },
        });
        await assert.rejects(
            api.mutate('account', {
                ...send,
                intent: { type: 'send', threadId: 'key', text: ' ' },
            }),
            fails('invalid_request'),
        );
        assert.equal(calls, 0);
        await assert.rejects(
            api.mutate('account', pin),
            fails('unknown_outcome'),
        );
        assert.equal(calls, 1);
    }
    let calls = 0;
    let account = 'account';
    const api = createInboxReader({
        account: () => account,
        tokens: async () => {
            account = 'changed';
            return tokens;
        },
        request: async () => {
            calls++;
            throw Error('unused');
        },
    });
    await assert.rejects(api.mutate('account', send), fails('auth'));
    await assert.rejects(api.mutate('other', pin), fails('auth'));
    assert.equal(calls, 0);
});

test('provider lost response timeout is unknown and invalid input never posts', async (t) => {
    const inbound = { receive(_value: ProviderResponseInput) {} };
    const sent: ProviderRequest[] = [];

    const provider = makeInboxProvider({
        ensureAnchor: async () => 1,
        extensionId: 'extension',
    });
    t.after(() => provider.dispose());
    provider.accept({
        name: PROVIDER_PORT,
        sender: {
            id: 'extension',
            frameId: 0,
            url: 'https://www.instagram.com/',
            tab: { id: 1 },
        },
        onMessage: {
            addListener: (listener) => {
                inbound.receive = listener;
            },
            removeListener: () => undefined,
        },
        onDisconnect: {
            addListener: () => undefined,
            removeListener: () => undefined,
        },
        postMessage: (request) => {
            sent.push(request);
        },
        disconnect: () => undefined,
    });
    const invalid = await Effect.runPromise(
        Effect.result(
            provider.mutate('account', { ...pin, threadFbid: undefined }),
        ),
    );
    assert(Result.isFailure(invalid));
    assert.equal(sent.length, 0);
    const result = await Effect.runPromise(
        Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(
                Effect.result(provider.mutate('account', pin)),
            );
            while (!sent.length) yield* Effect.yieldNow;
            yield* TestClock.adjust('15 seconds');
            return yield* Fiber.join(fiber);
        }).pipe(Effect.provide(TestClock.layer())),
    );
    assert(Result.isFailure(result));
    assert.equal(result.failure.kind, 'unknown_outcome');
});

test('send without reply transmits null reply and keeps immutable offline ID', async () => {
    const input = {
        ...send,
        intent: { type: 'send' as const, threadId: 'key', text: 'hello' },
    };
    const mutate = createInboxMutator({
        graphql: async (operation, variables) => {
            assert.equal(operation.friendlyName, 'IGDirectTextSendMutation');
            assert.equal(variables.reply_to_message_id, null);
            assert.equal(variables.offline_threading_id, '123');
            return {
                json: {
                    data: {
                        xig_direct_text_send_with_slide_messaging_response: {
                            id: 'sent',
                            message_id: 'sent',
                            timestamp_ms: '101',
                        },
                    },
                },
                viewerId: 'viewer',
            };
        },
        history: async (threadFbid) => {
            assert.equal(threadFbid, 'fbid');
            assert.notEqual(threadFbid, input.intent.threadId);
            return {
                items: [{ ...message, repliedTo: undefined }],
                thread,
                viewerId: 'viewer',
                hasNextPage: false,
            };
        },
    });
    assert.equal((await mutate('account', input)).type, 'send');
});

for (const failure of [
    'disconnect',
    'malformed',
    'wrong-state',
    'wrong-target',
] as const)
    test(`provider mutation ${failure} is unknown, not retryable transport failure`, async (t) => {
        const inbound = {
            receive(_value: ProviderResponseInput) {},
            disconnect() {},
        };

        const provider = makeInboxProvider({
            ensureAnchor: async () => 1,
            extensionId: 'extension',
        });
        t.after(() => provider.dispose());
        provider.accept({
            name: PROVIDER_PORT,
            sender: {
                id: 'extension',
                frameId: 0,
                url: 'https://www.instagram.com/',
                tab: { id: 1 },
            },
            onMessage: {
                addListener: (listener) => {
                    inbound.receive = listener;
                },
                removeListener: () => undefined,
            },
            onDisconnect: {
                addListener: (listener) => {
                    inbound.disconnect = listener;
                },
                removeListener: () => undefined,
            },
            postMessage: (request) => {
                if (failure === 'disconnect') {
                    inbound.disconnect();
                    return;
                }
                inbound.receive({
                    kind: 'response',
                    id: request.id,
                    method: 'mutate',
                    result: {
                        ok: true,
                        value:
                            failure === 'malformed'
                                ? {}
                                : {
                                      type: 'pin',
                                      threadFbid:
                                          failure === 'wrong-target'
                                              ? 'other'
                                              : 'fbid',
                                      isPinned: failure !== 'wrong-state',
                                  },
                    },
                });
            },
            disconnect: () => undefined,
        });
        const result = await Effect.runPromise(
            Effect.result(provider.mutate('account', pin)),
        );
        assert(Result.isFailure(result));
        assert.equal(result.failure.kind, 'unknown_outcome');
    });

test('invalid targets and timestamps are rejected before the API dispatch', async () => {
    let calls = 0;

    const mutate = createInboxMutator({
        graphql: async () => {
            calls++;
            throw Error('unexpected');
        },
        history: async () => {
            throw Error('unexpected');
        },
    });
    const invalid: MutationRequest[] = [
        { ...send, viewerId: undefined },
        { ...send, offlineThreadingId: 'not-numeric' },
        { ...pin, threadFbid: undefined },
        { ...read, threadIgId: undefined },
        {
            ...read,
            intent: {
                type: 'read',
                threadId: 'key',
                messageId: 'mid',
                timestampMs: NaN,
            },
        },
        {
            ...read,
            intent: {
                type: 'read',
                threadId: 'key',
                messageId: 'mid',
                timestampMs: -1,
            },
        },
        {
            ...read,
            intent: {
                type: 'read',
                threadId: 'key',
                messageId: 'mid',
                timestampMs: 1.5,
            },
        },
    ];
    for (const input of invalid)
        await assert.rejects(
            mutate('account', input),
            fails('invalid_request'),
        );
    assert.equal(calls, 0);
});

test('content preserves proven preflight auth but not post-dispatch account loss', async () => {
    for (const preflight of [true, false]) {
        let account = 'account';
        const response = await executeInboxProviderRequest(
            {
                kind: 'request',
                id: 1,
                method: 'mutate',
                expectedAccountId: 'account',
                request: pin,
            },
            {
                account: () => account,
                prepare: async () => undefined,
                mutate: async () => {
                    account = 'other';
                    if (preflight) throw new InboxError('auth');
                    return { type: 'pin', threadFbid: 'fbid', isPinned: true };
                },
                inbox: async () => {
                    throw Error('unused');
                },
                history: async () => {
                    throw Error('unused');
                },
            },
        );
        assert.equal(response.result.ok, false);
        if (!response.result.ok)
            assert.equal(
                response.result.error.kind,
                preflight ? 'auth' : 'unknown_outcome',
            );
    }
});
