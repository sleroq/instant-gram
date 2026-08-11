import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTAGRAM_GRAPHQL_OPERATIONS } from '../../lib/instagram-api/catalog.ts';
import {
    createInstagramCatalogHandlers,
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
    const handlers = createInstagramCatalogHandlers(
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

test('editText validates input and accepts only a matching captured receipt', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        IGDirectEditMessageMutation: { data: {
            direct_edit_message_with_slide_messaging_response: {
                message_id: 'mid.$message', timestamp_ms: '1786399709281', id: 'mid.$message',
            },
        } },
    }, calls));
    assert.deepEqual(await handlers.editText({
        threadFbid: '123', messageId: 'mid.$message', text: 'changed',
        offlineThreadingId: '7492703599464415944',
    }), { messageId: 'mid.$message', timestampMs: 1_786_399_709_281 });
    assert.deepEqual(calls, [{
        operation: 'IGDirectEditMessageMutation',
        input: {
            threadFbid: '123', targetMessageId: 'mid.$message', text: 'changed',
            offlineThreadingId: '7492703599464415944',
        },
    }]);
});

test('markThreadRead waits for both mutations to settle before exposing a failure', async () => {
    let resolveValidation!: (value: unknown) => void;
    const handlers = createInstagramCatalogHandlers(async operation => {
        if (operation === 'useIGDMarkThreadAsReadMutation') throw new Error('receipt failed');
        if (operation === 'useIGDMarkThreadAsReadValidationMutation') {
            return new Promise(resolve => { resolveValidation = resolve; });
        }
        throw new Error(`Unexpected operation ${operation}`);
    });
    const marking = handlers.markThreadRead({
        threadIgId: 'thread-igid',
        messageId: 'message-id',
        messageTimestampMs: 1_785_763_880_444,
    });
    let settled = false;
    void marking.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);

    resolveValidation({ data: { xig_direct_mark_read_id_validation: false } });
    await assert.rejects(marking, /receipt failed/);
});

test('markThreadRead labels failures from both required mutations', async () => {
    const handlers = createInstagramCatalogHandlers(async operation => {
        throw new Error(operation === 'useIGDMarkThreadAsReadMutation'
            ? 'receipt transport failed'
            : 'validation transport failed');
    });
    await assert.rejects(handlers.markThreadRead({
        threadIgId: 'thread-igid',
        messageId: 'message-id',
        messageTimestampMs: 1_785_763_880_444,
    }), /receipt: receipt transport failed; validation: validation transport failed/);
});

test('forwardMessage validates and parses the captured reel receipt', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        IGDirectReelShareMutation: {
            data: { xig_direct_clip_share_with_slide_msg_response: {
                message_id: 'forwarded-message', timestamp_ms: '1786303825317',
            } },
        },
    }, calls));
    assert.deepEqual(await handlers.forwardMessage({
        targetThreadFbid: '1776201113780017',
        sourceThreadIgId: '340282366841710301244259951218690866993',
        sourceIsViewer: false,
        offlineThreadingId: '7492301276698669817',
        content: { kind: 'reel', mediaId: '3958077625981405644' },
    }), {
        messageId: 'forwarded-message',
        timestampMs: 1_786_303_825_317,
        clientRequestId: '7492301276698669817',
    });
    assert.equal(calls[0].operation, 'IGDirectReelShareMutation');
});

test('forwardMessage dispatches posts and parses the captured media-share receipt', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        IGDirectMediaShareMutation: {
            data: { direct_media_share_with_slide_response: {
                message_id: 'forwarded-post', timestamp_ms: '1786319322938',
            } },
        },
    }, calls));
    assert.deepEqual(await handlers.forwardMessage({
        targetThreadFbid: '1690220865705159',
        sourceThreadIgId: '340282366841710301244259865238442792135',
        sourceIsViewer: false,
        offlineThreadingId: '7492366277580327777',
        content: { kind: 'post', mediaId: '3954299726581330343' },
    }), {
        messageId: 'forwarded-post',
        timestampMs: 1_786_319_322_938,
        clientRequestId: '7492366277580327777',
    });
    assert.equal(calls[0].operation, 'IGDirectMediaShareMutation');
});

test('semantic handlers dispatch to the catalog with exact caller-supplied send IDs', async () => {
    const calls: Call[] = [];
    const execute = executor(
        {
            IGDirectTextSendMutation: {
                data: {
                    xig_direct_text_send_with_slide_messaging_response: {
                        message_id: 'sent-message',
                        timestamp_ms: '1785763880444',
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
    );
    const handlers = createInstagramRpcHandlers(execute);
    const catalogHandlers = createInstagramCatalogHandlers(execute);

    assert.deepEqual(await handlers.sendText({
        threadFbid: 'thread',
        text: 'hello',
        replyToMessageId: 'reply',
        offlineThreadingId: '0007489792462469606177',
    }), {
        messageId: 'sent-message',
        timestampMs: 1_785_763_880_444,
        clientRequestId: '0007489792462469606177',
    });
    assert.deepEqual(await handlers.sendText({
        threadFbid: 'thread',
        text: 'again',
        offlineThreadingId: '9001',
    }), {
        messageId: 'sent-message',
        timestampMs: 1_785_763_880_444,
        clientRequestId: '9001',
    });
    await catalogHandlers.getMessageRequests({ folder: 'SPAM', cursor: 'next' });

    assert.deepEqual(calls, [
        {
            operation: 'IGDirectTextSendMutation',
            input: {
                threadFbid: 'thread',
                text: 'hello',
                replyToMessageId: 'reply',
                offlineThreadingId: '0007489792462469606177',
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

test('reaction handler returns the authoritative captured reaction state', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramCatalogHandlers(executor({
        IGDirectReactionSendMutation: {
            data: {
                xig_direct_reaction_send_with_slide_messaging_response: {
                    slide_message: {
                        id: 'message-1',
                        reactions: [{
                            reaction: '❤',
                            reaction_timestamp_ms: '1783181919592',
                            sender_fbid: 'viewer-1',
                        }],
                    },
                },
            },
        },
    }, calls));

    assert.deepEqual(await handlers.setReaction({
        threadFbid: 'thread-1', messageId: 'message-1', emoji: '❤', remove: false,
    }), {
        messageId: 'message-1',
        reactions: [{
            senderId: 'viewer-1', reaction: '❤', timestampMs: 1_783_181_919_592,
        }],
    });
    assert.deepEqual(calls, [{
        operation: 'IGDirectReactionSendMutation',
        input: { threadFbid: 'thread-1', messageId: 'message-1', emoji: '❤', remove: false },
    }]);
});

test('reel action handlers dispatch distinct captured mutations and validate receipts', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        PolarisAPILikePostMutation: {
            data: { xig_media_like: { media: { id: '3953224267254190889_5654194264', has_liked: true } } },
        },
        PolarisAPIUnsavePostMutation: {
            data: { xig_media_unsave: { media: { id: '3953224267254190889_5654194264' } } },
        },
    }, calls));
    assert.deepEqual(await handlers.setReelLiked({
        mediaId: '3953224267254190889', liked: true,
    }), { mediaId: '3953224267254190889', hasLiked: true });
    assert.deepEqual(await handlers.setReelSaved({
        mediaId: '3953224267254190889', saved: false,
    }), { mediaId: '3953224267254190889', hasSaved: false });
    assert.deepEqual(calls, [{
        operation: 'PolarisAPILikePostMutation',
        input: { mediaId: '3953224267254190889', clientMutationId: '1' },
    }, {
        operation: 'PolarisAPIUnsavePostMutation',
        input: { mediaId: '3953224267254190889', clientMutationId: '2' },
    }]);
    await assert.rejects(
        createInstagramRpcHandlers(executor({
            PolarisAPILikePostMutation: {
                data: { xig_media_like: { media: { id: '999_5654194264' } } },
            },
        }, [])).setReelLiked({ mediaId: '3953224267254190889', liked: true }),
        /did not match/,
    );
});

test('conversation pin handler selects the exact mutation and rejects mismatched receipts', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramRpcHandlers(executor({
        useIGDPinThreadMutation: {
            data: { xig_direct_pin_thread: { is_pin: true, id: '1789001' } },
        },
        useIGDUnpinThreadMutation: {
            data: { xig_direct_pin_thread: { is_pin: true, id: '1789001' } },
        },
    }, calls));
    assert.deepEqual(await handlers.togglePin({
        threadKey: 'route-key', threadFbid: '1789001', pin: true,
    }), {
        pinned: [],
        receipt: { threadFbid: '1789001', isPinned: true },
    });
    await assert.rejects(
        handlers.togglePin({ threadKey: 'route-key', threadFbid: '1789001', pin: false }),
        /did not match/,
    );
    assert.deepEqual(calls.map(call => call.operation), [
        'useIGDPinThreadMutation',
        'useIGDUnpinThreadMutation',
    ]);
    assert.deepEqual(calls[0]?.input, { threadFbid: '1789001' });
    await assert.rejects(
        handlers.togglePin({ threadKey: 'opaque-route', threadFbid: 'not-numeric', pin: true }),
        /Invalid Instagram thread FBID/,
    );
});

test('unread count includes pending and spam bounded pages', async () => {
    const calls: Call[] = [];
    const mailbox = (id: string, hasNextPage: boolean) => ({
        threads_by_folder: {
            edges: [{ node: { as_ig_direct_thread: { id, marked_as_unread: true } } }],
            page_info: { has_next_page: hasNextPage },
        },
    });
    const handlers = createInstagramCatalogHandlers(executor({
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

    assert.deepEqual(await handlers.getUnreadCount(), {
        countedTotal: 3,
        inbox: { count: 1, hasMore: true },
        requests: { count: 1, hasMore: false },
        spam: { count: 1, hasMore: true },
    });
    assert.equal(calls[1]?.operation, 'PolarisDirectMessageRequestQuery');
});

test('pin returns authoritative IDs and cutout send reuses supplied request ID', async () => {
    const calls: Call[] = [];
    const handlers = createInstagramCatalogHandlers(executor({
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
    const handlers = createInstagramCatalogHandlers(
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
    const handlers = createInstagramCatalogHandlers(executor({}, calls));
    await assert.rejects(
        handlers.sendText({ threadFbid: '', text: 'hello', offlineThreadingId: '1' }),
        /thread FBID/,
    );
    await assert.rejects(
        handlers.sendText({ threadFbid: 'thread', text: ' '.repeat(2), offlineThreadingId: '1' }),
        /message text/,
    );
    await assert.rejects(
        handlers.sendText({
            threadFbid: 'thread', text: 'hello', offlineThreadingId: 'not-numeric',
        }),
        /offline threading ID/,
    );
    await assert.rejects(
        handlers.sendText({ threadFbid: 'thread', text: 'hello' } as never),
        /offline threading ID/,
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
    assert.equal(Object.keys(INSTAGRAM_RPC_OPERATION_REACHABILITY).length, 40);
    assert.equal(
        INSTAGRAM_RPC_OPERATION_REACHABILITY.IGDirectCutoutStickerShareMutation,
        'sendCutoutSticker',
    );
    // Legacy operations remain deliberately outside the closed secondary catalog.
    assert.equal(Object.hasOwn(INSTAGRAM_GRAPHQL_OPERATIONS, 'IGDMessageListOffMsysQuery'), false);
    assert.equal(Object.hasOwn(INSTAGRAM_GRAPHQL_OPERATIONS, 'PolarisPostActionLoadPostQueryQuery'), false);
});
