import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTAGRAM_GRAPHQL_OPERATIONS } from '../../lib/instagram-api/catalog.ts';
import {
    createInstagramRpcHandlers,
    INSTAGRAM_RPC_OPERATION_REACHABILITY,
    parseInstagramGraphqlPayload,
    type InstagramOperationExecutor,
} from '../../lib/instagram-api/handlers.ts';

type Call = { operation: string; input: Record<string, unknown> };

function executor(
    responses: Record<string, unknown>,
    calls: Call[],
): InstagramOperationExecutor {
    return async (operation, input) => {
        calls.push({ operation, input });
        const response = responses[operation];
        if (response === undefined) throw new Error(`No fixture for ${operation}`);
        return response;
    };
}

test('markThreadRead accepts captured false validation after a successful receipt', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(
        executor(
            {
                useIGDMarkThreadAsReadMutation: {
                    data: {
                        xig_direct_item_seen_mutation_with_slide_messaging_response: {
                            participant_fbid: 'viewer',
                        },
                    },
                },
                useIGDMarkThreadAsReadValidationMutation: {
                    data: { xig_direct_mark_read_id_validation: false },
                },
            },
            calls,
        ),
    );

    assert.deepEqual(
        await handlers.markThreadRead({
            threadIgId: 'thread-igid',
            messageId: 'message-id',
            messageTimestampMs: 1_785_763_880_444,
        }),
        { success: true },
    );
    assert.deepEqual(calls, [
        {
            operation: 'useIGDMarkThreadAsReadMutation',
            input: {
                threadIgId: 'thread-igid',
                messageId: 'message-id',
                messageTimestampMs: 1_785_763_880_444,
            },
        },
        {
            operation: 'useIGDMarkThreadAsReadValidationMutation',
            input: {
                threadIgId: 'thread-igid',
                messageId: 'message-id',
                messageTimestampMs: 1_785_763_880_444,
            },
        },
    ]);
});

test('semantic handlers dispatch to the catalog with exact caller-supplied send IDs', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(
        executor(
            {
                IGDirectTextSendMutation: {
                    data: {
                        xig_direct_text_send_with_slide_messaging_response: {
                            message_id: 'sent-message',
                        },
                    },
                },
                IGDThreadListOffMsysPaginationQuery: {
                    data: {
                        fetch__SlideMailbox: {
                            threads_by_folder: {
                                edges: [],
                                page_info: { has_next_page: false },
                            },
                        },
                    },
                },
                PolarisDirectInboxQuery: {
                    data: {
                        get_slide_mailbox_for_iris_subscription: {
                            id: 'mailbox-viewer',
                            threads_by_folder: {
                                edges: [],
                                page_info: { has_next_page: false },
                            },
                        },
                    },
                },
            },
            calls,
        ),
    );

    assert.deepEqual(await handlers.sendText({
        threadFbid: 'thread',
        text: 'hello',
        replyToMessageId: 'reply',
        clientRequestId: '7489792462469606177',
    }), {
        messageId: 'sent-message',
        timestampMs: undefined,
        clientRequestId: '7489792462469606177',
    });
    assert.deepEqual(await handlers.sendText({
        threadFbid: 'thread',
        text: 'again',
        clientRequestId: '9001',
    }), {
        messageId: 'sent-message',
        timestampMs: undefined,
        clientRequestId: '9001',
    });
    await handlers.getMessageRequests({ folder: 'SPAM', cursor: 'next' });

    assert.deepEqual(calls, [
        {
            operation: 'IGDirectTextSendMutation',
            input: {
                threadFbid: 'thread',
                text: 'hello',
                replyToMessageId: 'reply',
                offlineThreadingId: '7489792462469606177',
            },
        },
        {
            operation: 'IGDirectTextSendMutation',
            input: {
                threadFbid: 'thread',
                text: 'again',
                replyToMessageId: undefined,
                offlineThreadingId: '9001',
            },
        },
        {
            operation: 'PolarisDirectInboxQuery',
            input: {},
        },
        {
            operation: 'IGDThreadListOffMsysPaginationQuery',
            input: {
                count: 5,
                cursor: 'next',
                folder: 'JUNK',
                newerThanTimestampMs: null,
                mailboxId: 'mailbox-viewer',
            },
        },
    ]);
});

test('unread count includes pending and spam bounded pages', async () => {
    const calls: Call[] = [];
    const mailbox = (id: string, hasNextPage: boolean) => ({
        threads_by_folder: {
            edges: [{ node: { as_ig_direct_thread: { id, marked_as_unread: true } } }],
            page_info: { has_next_page: hasNextPage },
        },
    });
    const handlers = createInstagramRpcHandlers(executor({
        IGDBadgeCountOffMsysQuery: {
            data: { get_slide_mailbox_for_iris_subscription: mailbox('inbox', true) },
        },
        PolarisDirectMessageRequestQuery: {
            data: {
                get_slide_mailbox_for_iris_subscription: mailbox('pending', false),
                spamMailbox: mailbox('spam', true),
            },
        },
    }, calls), { now: () => 1_800_000_000_000 });

    assert.deepEqual(await handlers.getUnreadCount(undefined), {
        countedTotal: 3,
        inbox: { count: 1, hasMore: true },
        requests: { count: 1, hasMore: false },
        spam: { count: 1, hasMore: true },
    });
    assert.equal(calls[1]?.operation, 'PolarisDirectMessageRequestQuery');
});

test('pin returns authoritative IDs and cutout send reuses supplied request ID', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        useIGDPinMessageOffMsysMutation: {
            data: { xig_direct_pin_message: { pinned_messages: [{ message_id: 'm1' }] } },
        },
        IGDirectCutoutStickerShareMutation: {
            data: { ig_direct_cutout_sticker_share_with_slide_msg_response: { message_id: 'sent-sticker' } },
        },
    }, calls));
    assert.deepEqual(await handlers.pinMessage({ threadFbid: 'fbid', messageId: 'm1' }), {
        pinnedMessageIds: ['m1'],
    });
    assert.deepEqual(await handlers.sendCutoutSticker({
        threadFbid: 'fbid', stickerId: 'sticker', clientRequestId: '12345',
    }), {
        messageId: 'sent-sticker', timestampMs: undefined, clientRequestId: '12345',
    });
    assert.equal(calls[1]?.input.offlineThreadingId, '12345');
});

test('secondary GraphQL is discriminated, closed, and accepts captured empty search', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(
        executor(
            {
                IGDComposerRichContentMusicSearchQuery: {
                    data: { xfb_ig_audio_search: { items: [] } },
                    extensions: { internal: 'not exposed' },
                },
                IGDComposerRichContentStickersV2Query: {
                    data: { xig_igd_stickers_query: { sections: { edges: [] } } },
                },
            },
            calls,
        ),
    );
    assert.deepEqual(
        await handlers.executeInstagramGraphql({
            operation: 'IGDComposerRichContentMusicSearchQuery',
            query: '',
        }),
        {
            operation: 'IGDComposerRichContentMusicSearchQuery',
            tracks: [],
            cursor: undefined,
            hasNextPage: false,
        },
    );
    assert.deepEqual(calls[0], {
        operation: 'IGDComposerRichContentMusicSearchQuery',
        input: { query: '' },
    });
    assert.deepEqual(
        await handlers.executeInstagramGraphql({
            operation: 'IGDComposerRichContentStickersV2Query',
            searchQuery: '',
        }),
        { operation: 'IGDComposerRichContentStickersV2Query', sections: [] },
    );

    await assert.rejects(
        handlers.executeInstagramGraphql({
            operation: 'IGDInboxTrayQuery',
            docId: 'attacker-controlled',
        } as never),
        /payload fields/,
    );
    await assert.rejects(
        handlers.executeInstagramGraphql({
            operation: 'ArbitraryQuery',
            variables: {},
        } as never),
        /Unsupported/,
    );
    assert.throws(
        () => parseInstagramGraphqlPayload({ errors: [{ message: 'secret' }] }),
        /^Error: Instagram GraphQL request failed$/,
    );
});

test('credentialed handler boundary rejects empty IDs and invalid values before dispatch', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({}, calls));
    await assert.rejects(
        handlers.sendText({ threadFbid: '', text: 'hello', clientRequestId: '1' }),
        /thread FBID/,
    );
    await assert.rejects(
        handlers.sendText({ threadFbid: 'thread', text: ' '.repeat(2), clientRequestId: '1' }),
        /message text/,
    );
    await assert.rejects(
        handlers.sendText({
            threadFbid: 'thread', text: 'hello', clientRequestId: 'not-numeric',
        }),
        /client request ID/,
    );
    await assert.rejects(
        handlers.sendText({ threadFbid: 'thread', text: 'hello' } as never),
        /client request ID/,
    );
    await assert.rejects(
        handlers.sendCutoutSticker({
            threadFbid: 'thread', stickerId: 'sticker',
        } as never),
        /client request ID/,
    );
    await assert.rejects(
        handlers.markThreadRead({
            threadIgId: 'thread',
            messageId: 'message',
            messageTimestampMs: -1,
        }),
        /timestamp/,
    );
    await assert.rejects(
        handlers.getInbox({ cursor: 'x'.repeat(4_097) }),
        /cursor is too long/,
    );
    assert.equal(calls.length, 0);
});

test('every closed catalog operation has a semantic or secondary RPC route', () => {
    assert.deepEqual(
        Object.keys(INSTAGRAM_RPC_OPERATION_REACHABILITY).sort(),
        Object.keys(INSTAGRAM_GRAPHQL_OPERATIONS).sort(),
    );
    assert.equal(Object.keys(INSTAGRAM_RPC_OPERATION_REACHABILITY).length, 29);
    assert.equal(
        INSTAGRAM_RPC_OPERATION_REACHABILITY.IGDirectCutoutStickerShareMutation,
        'sendCutoutSticker',
    );
    // Legacy operations remain deliberately outside the closed secondary catalog.
    assert.equal(Object.hasOwn(INSTAGRAM_GRAPHQL_OPERATIONS, 'IGDMessageListOffMsysQuery'), false);
    assert.equal(Object.hasOwn(INSTAGRAM_GRAPHQL_OPERATIONS, 'PolarisPostActionLoadPostQueryQuery'), false);
});
