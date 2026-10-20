import assert from 'node:assert/strict';
import test from 'node:test';
import { createInboxReader } from '../lib/instagram-api/inbox.ts';
import { INSTAGRAM_GRAPHQL_OPERATIONS } from '../lib/instagram-api/catalog.ts';
import { isJsonObject, parseJson, type JsonValue } from '../lib/json.ts';
import type { Tokens } from '../lib/ig-auth.ts';

const tokens: Tokens = {
    viewerId: 'viewer-not-account',
    deviceId: 'device',
    fbDtsg: 'test',
    lsd: 'test',
    jazoest: 'test',
    csrfToken: 'test',
};
function inboxResponse(mailboxId: string) {
    return {
        data: {
            get_slide_mailbox_for_iris_subscription: {
                id: mailboxId,
                threads_by_folder: {
                    edges: [],
                    page_info: { has_next_page: false, end_cursor: null },
                },
            },
        },
    };
}
function historyResponse() {
    return {
        data: {
            get_slide_thread_nullable: {
                as_ig_direct_thread: {
                    thread_key: 'thread',
                    thread_fbid: 'operation',
                    users: [],
                    viewer: { interop_messaging_user_fbid: 'strong-viewer' },
                    slide_messages: {
                        edges: [],
                        page_info: { has_next_page: false, end_cursor: null },
                    },
                },
            },
        },
    };
}

test('live reader uses exact captured descriptors, opaque cursors, and account-scoped mailbox identity', async () => {
    let account = 'account-1';
    const calls: Array<{ name: string; variables: JsonValue; id: string }> = [];
    const reader = createInboxReader({
        account: () => account,
        tokens: async () => tokens,
        request: async (_url, init) => {
            assert.ok(init?.body instanceof URLSearchParams);
            const name = init.body.get('fb_api_req_friendly_name')!;
            calls.push({
                name,
                variables: parseJson(init.body.get('variables')!),
                id: init.body.get('doc_id')!,
            });
            return Response.json(
                name ===
                    INSTAGRAM_GRAPHQL_OPERATIONS.PolarisDirectInboxQuery
                        .friendlyName ||
                    name ===
                        INSTAGRAM_GRAPHQL_OPERATIONS
                            .IGDThreadListOffMsysPaginationQuery.friendlyName
                    ? inboxResponse(`mailbox-${account}`)
                    : historyResponse(),
            );
        },
    });

    await reader.inbox();
    await reader.inbox('opaque:page/==');
    assert.deepEqual(
        calls[1].variables,
        INSTAGRAM_GRAPHQL_OPERATIONS.IGDThreadListOffMsysPaginationQuery.buildVariables(
            {
                cursor: 'opaque:page/==',
                mailboxId: 'mailbox-account-1',
            },
            tokens,
        ),
    );

    const history = await reader.history('operation');
    assert.equal(history.viewerId, 'strong-viewer');
    assert.deepEqual(
        calls[2].variables,
        INSTAGRAM_GRAPHQL_OPERATIONS.IGDThreadDetailQuery.buildVariables(
            { threadKey: 'operation' },
            tokens,
        ),
    );

    await reader.history('operation', 'older/==');
    assert.deepEqual(calls[3].variables, {
        after: 'older/==',
        before: null,
        first: 20,
        last: null,
        newer_than_message_id: null,
        older_than_message_id: null,
        id: 'operation',
        __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
    });
    assert.deepEqual(
        calls[3].variables,
        INSTAGRAM_GRAPHQL_OPERATIONS.IGDMessageListOffMsysQuery.buildVariables(
            { threadKey: 'operation', cursor: 'older/==' },
            tokens,
        ),
    );

    account = 'account-2';
    await reader.inbox('same-cursor');
    assert.equal(
        calls[4].name,
        INSTAGRAM_GRAPHQL_OPERATIONS.PolarisDirectInboxQuery.friendlyName,
    );
    assert.ok(isJsonObject(calls[5].variables));
    assert.equal(calls[5].variables.id, 'mailbox-account-2');
});

test('malformed HTTP-success and GraphQL error responses are not cached-empty success', async () => {
    for (const payload of [
        {},
        { errors: [{ message: 'redacted' }] },
        {
            data: {
                get_slide_mailbox_for_iris_subscription: {
                    threads_by_folder: { edges: [] },
                },
            },
        },
    ]) {
        const reader = createInboxReader({
            account: () => 'account',
            tokens: async () => tokens,
            request: async () => Response.json(payload),
        });
        await assert.rejects(reader.inbox(), { kind: 'protocol' });
        await assert.rejects(reader.history('operation'), { kind: 'protocol' });
    }
});

test('account change during token preparation prevents dispatch, and bootstrap cannot reuse another mailbox', async () => {
    let account = 'first';
    let calls = 0;
    const reader = createInboxReader({
        account: () => account,
        tokens: async () => {
            account = 'second';
            return tokens;
        },
        request: async () => {
            calls++;
            return Response.json(inboxResponse('first-mailbox'));
        },
    });
    await assert.rejects(reader.inbox('cursor'), { kind: 'auth' });
    assert.equal(calls, 0);

    account = 'first';
    const changed = createInboxReader({
        account: () => account,
        tokens: async () => tokens,
        request: async () => {
            calls++;
            account = 'second';
            return Response.json(inboxResponse('first-mailbox'));
        },
    });
    await assert.rejects(changed.inbox('cursor'), { kind: 'auth' });
    assert.equal(calls, 1);
});

test('read authentication failures are classified and legitimate empty connections stay present', async () => {
    for (const status of [401, 403]) {
        const reader = createInboxReader({
            account: () => 'account',
            tokens: async () => tokens,
            request: async () => new Response('', { status }),
        });
        await assert.rejects(reader.inbox(), { kind: 'auth' });
    }
    const reader = createInboxReader({
        account: () => 'account',
        tokens: async () => tokens,
        request: async () =>
            Response.json({ ...inboxResponse('mailbox'), errors: [] }),
    });
    assert.deepEqual((await reader.inbox()).items, []);
});

test('a continuing inbox requires its captured mailbox identity', async () => {
    const reader = createInboxReader({
        account: () => 'account',
        tokens: async () => tokens,
        request: async () =>
            Response.json({
                data: {
                    get_slide_mailbox_for_iris_subscription: {
                        threads_by_folder: {
                            edges: [],
                            page_info: {
                                has_next_page: true,
                                end_cursor: 'opaque',
                            },
                        },
                    },
                },
            }),
    });
    await assert.rejects(reader.inbox(), { kind: 'protocol' });
});

test('intentionally suppressed history edges do not turn valid reads into protocol failures', async () => {
    const response = historyResponse();
    const thread = response.data.get_slide_thread_nullable.as_ig_direct_thread;
    const reader = createInboxReader({
        account: () => 'account',
        tokens: async () => tokens,
        request: async () =>
            Response.json({
                data: {
                    get_slide_thread_nullable: {
                        as_ig_direct_thread: {
                            ...thread,
                            slide_messages: {
                                edges: [
                                    {
                                        node: {
                                            content_type: 'REACTION_LOG_XMAT',
                                            message_id: 'suppressed',
                                        },
                                    },
                                ],
                                page_info: {
                                    has_next_page: false,
                                    end_cursor: null,
                                },
                            },
                        },
                    },
                },
            }),
    });
    assert.deepEqual((await reader.history('operation')).items, []);
});
