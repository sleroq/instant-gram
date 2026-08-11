import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildReelCommentRepliesPath,
    INSTAGRAM_GRAPHQL_OPERATIONS as operations,
    isInstagramGraphqlOperationName,
} from '../../lib/instagram-api/catalog.ts';

const context = { viewerId: 'viewer-1', deviceId: 'device-1' };

test('inbox pagination uses the captured generation and exact relay variables', () => {
    const operation = operations.IGDThreadListOffMsysPaginationQuery;
    assert.equal(operation.docId, '28035404249479587');
    assert.equal(operation.kind, 'query');
    assert.deepEqual(
        operation.buildVariables(
            {
                count: 5,
                cursor: 'next',
                folder: 'INBOX',
                newerThanTimestampMs: null,
                mailboxId: 'mailbox-1',
            },
            context,
        ),
        {
            count: 5,
            cursor: 'next',
            folder: 'INBOX',
            newer_than_timestamp_ms: null,
            id: 'mailbox-1',
            __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
            __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
            __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
            __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true,
        },
    );
});

test('text and read builders preserve captured nulls and string timestamps', () => {
    assert.deepEqual(
        operations.IGDirectTextSendMutation.buildVariables(
            {
                threadFbid: 'thread',
                offlineThreadingId: 'offline',
                text: 'hello',
                replyToMessageId: 'message',
            },
            context,
        ),
        {
            ig_thread_igid: 'thread',
            offline_threading_id: 'offline',
            recipient_igids: null,
            replied_to_client_context: null,
            replied_to_item_id: null,
            reply_to_message_id: 'message',
            sampled: null,
            text: { sensitive_string_value: 'hello' },
            mentions: [],
            mentioned_user_ids: [],
            commands: null,
            forwarded_from_thread_id: null,
            is_forwarded_from_own_message: null,
            send_attribution: 'igd_web_chat_tab:in_thread',
        },
    );
    assert.deepEqual(
        [
            operations.useIGDMarkThreadAsReadMutation.docId,
            operations.useIGDMarkThreadAsReadMutation.buildVariables(
                { threadIgId: 'igid', messageId: 'message' },
                context,
            ),
        ],
        [
            '27356881703909995',
            {
                metadata: { ig_thread_igid: 'igid' },
                data: { item_id: '', message_id: 'message' },
            },
        ],
    );
    assert.equal(
        operations.useIGDMarkThreadAsReadValidationMutation.docId,
        '35211594988486314',
    );
    assert.deepEqual(
        operations.useIGDMarkThreadAsReadValidationMutation.buildVariables(
            {
                threadIgId: 'igid',
                messageId: 'message',
                messageTimestampMs: 1_785_763_880_444,
            },
            context,
        ),
        {
            metadata: { ig_thread_igid: 'igid' },
            data: {
                message_id: 'message',
                message_timestamp_ms: '1785763880444',
            },
        },
    );
});

test('message editing uses the captured mutation variables', () => {
    const operation = operations.IGDirectEditMessageMutation;
    assert.equal(operation.docId, '32480262318254796');
    assert.equal(operation.friendlyName, 'IGDirectEditMessageMutation');
    assert.deepEqual(operation.buildVariables({
        threadFbid: '1020994220298545',
        targetMessageId: 'mid.$message',
        text: 'edited text',
        offlineThreadingId: '7492703599464415944',
    }, context), {
        thread_id: '1020994220298545',
        target_item_id: null,
        body: { sensitive_string_value: 'edited text' },
        offline_threading_id: '7492703599464415944',
        target_message_id: 'mid.$message',
    });
});

test('reel forwarding uses the existing-thread branch from the captured client', () => {
    const operation = operations.IGDirectReelShareMutation;
    assert.equal(operation.docId, '26212720875066239');
    assert.deepEqual(operation.buildVariables({
        targetThreadFbid: 'target-operation-id',
        sourceThreadIgId: 'source-large-id',
        sourceIsViewer: false,
        offlineThreadingId: '7492301276698669817',
        mediaId: '3958077625981405644',
    }, context), {
        ig_media_igid: '3958077625981405644',
        otid: '7492301276698669817',
        data: {
            forwarded_from_thread_id: 'source-large-id',
            is_forwarded_from_own_message: false,
            offline_threading_id: '7492301276698669817',
            recipient_users: null,
            thread_id: 'target-operation-id',
        },
        clip_share_params: {
            inventory_source: null,
            send_attribution: null,
            social_context_share_type: null,
            text: null,
            tracking_token: null,
        },
    });
});

test('post forwarding uses the captured media-share existing-thread variables', () => {
    const operation = operations.IGDirectMediaShareMutation;
    assert.equal(operation.docId, '27442850591982122');
    assert.deepEqual(operation.buildVariables({
        targetThreadFbid: 'target-operation-id',
        sourceThreadIgId: 'source-large-id',
        sourceIsViewer: false,
        offlineThreadingId: '7492366277580327777',
        mediaId: '3954299726581330343',
    }, context), {
        send_data: {
            forwarded_from_thread_id: 'source-large-id',
            is_forwarded_from_own_message: false,
            offline_threading_id: '7492366277580327777',
            recipient_users: null,
            thread_id: 'target-operation-id',
        },
        data: { media_id: '3954299726581330343' },
    });
});

test('reaction builder matches the HAR-backed mutation variables exactly', () => {
    assert.deepEqual(
        operations.IGDirectReactionSendMutation.buildVariables(
            {
                threadFbid: '340282366841710300949128133551876018644',
                messageId: 'mid.$cAABa-Z8DgqJu9RqQy2iUnYadFQdn',
                emoji: '❤',
                remove: false,
            },
            context,
        ),
        {
            input: {
                emoji: '❤',
                item_id: '',
                message_id: 'mid.$cAABa-Z8DgqJu9RqQy2iUnYadFQdn',
                reaction_status: 'created',
                thread_id: '340282366841710300949128133551876018644',
            },
        },
    );
    assert.deepEqual(
        operations.IGDirectReactionSendMutation.buildVariables({
            threadFbid: 'thread', messageId: 'message', emoji: '❤', remove: true,
        }, context),
        { input: {
            emoji: '❤', item_id: '', message_id: 'message', reaction_status: 'deleted', thread_id: 'thread',
        } },
    );
});

test('reel like and save mutations match captured documents and variables', () => {
    const input = { mediaId: '3953224267254190889', clientMutationId: '7' };
    const variables = {
        input: {
            media_id: input.mediaId,
            actor_id: context.viewerId,
            client_mutation_id: '7',
        },
    };
    assert.deepEqual([
        operations.PolarisAPILikePostMutation.docId,
        operations.PolarisAPILikePostMutation.buildVariables(input, context),
        operations.PolarisAPIUnlikePostMutation.docId,
        operations.PolarisAPISavePostMutation.docId,
        operations.PolarisAPIUnsavePostMutation.docId,
    ], [
        '27358573637160660', variables,
        '37071567952434061',
        '27326721586982367',
        '27203919972607144',
    ]);
});

test('comment like mutation matches the captured document and variables', () => {
    const operation = operations.PolarisCommentActionsLikeMutation;
    assert.deepEqual([
        operation.friendlyName,
        operation.docId,
        operation.kind,
        operation.buildVariables({ commentId: '18137453275573708', clientMutationId: '3' }, context),
    ], [
        'PolarisCommentActionsLikeMutation',
        '27184292767848867',
        'mutation',
        { input: {
            comment_id: '18137453275573708',
            actor_id: context.viewerId,
            client_mutation_id: '3',
        } },
    ]);
});

test('comment reply requests preserve the captured initial and continuation query exactly', () => {
    assert.equal(
        buildReelCommentRepliesPath({ mediaId: '3934614549645286134', commentId: '18118594957890789' }),
        '/api/v1/media/3934614549645286134/comments/18118594957890789/child_comments/?min_id=&is_chronological=true&paging_direction=view_more',
    );
    assert.equal(
        buildReelCommentRepliesPath({
            mediaId: '3934614549645286134',
            commentId: '18118594957890789',
            cursor: 'AQHSekuoBSw-07Qpuh8JYCJhfoKNJtH8Emoe1fPesCfqh8JcGri5dLRXoBJFQPt1nCQXFXLUv0zQEiVXeWnCFBMmEw',
        }),
        '/api/v1/media/3934614549645286134/comments/18118594957890789/child_comments/?min_id=AQHSekuoBSw-07Qpuh8JYCJhfoKNJtH8Emoe1fPesCfqh8JcGri5dLRXoBJFQPt1nCQXFXLUv0zQEiVXeWnCFBMmEw&is_chronological=true&paging_direction=view_more',
    );
});

test('hover-card friendship lookup uses the captured liker identity request', () => {
    const operation = operations.PolarisUserHoverCardContentV2Query;
    assert.deepEqual([
        operation.friendlyName,
        operation.docId,
        operation.kind,
        operation.buildVariables({ userId: '35122899956' }, context),
    ], [
        'PolarisUserHoverCardContentV2Query',
        '27756568060663620',
        'query',
        { userID: '35122899956' },
    ]);
});

test('conversation pin and unpin use distinct current web documents and exact variables', () => {
    const pin = operations.useIGDPinThreadMutation;
    const unpin = operations.useIGDUnpinThreadMutation;
    assert.deepEqual(
        [pin.friendlyName, pin.docId, pin.kind, pin.buildVariables({ threadFbid: 'fbid' }, context)],
        ['useIGDPinThreadMutation', '26491513390471063', 'mutation', { thread_fbid: 'fbid', pin: true }],
    );
    assert.deepEqual(
        [unpin.friendlyName, unpin.docId, unpin.kind, unpin.buildVariables({ threadFbid: 'fbid' }, context)],
        ['useIGDUnpinThreadMutation', '26719492947719993', 'mutation', { thread_fbid: 'fbid', pin: false }],
    );
});

test('catalog is a closed DM allowlist', () => {
    assert.equal(Object.keys(operations).length, 40);
    assert.equal(isInstagramGraphqlOperationName('IGDirectReactionSendMutation'), true);
    for (const shellOperation of [
        'PolarisFeedTimelinePaginationQuery',
        'PolarisStoriesV3TrayContainerQuery',
        'PolarisAccountSwitcherQuery',
        'PolarisViewerSettingsQuery',
    ]) {
        assert.equal(isInstagramGraphqlOperationName(shellOperation), false);
        assert.equal(Object.hasOwn(operations, shellOperation), false);
    }
});
