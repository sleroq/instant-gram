import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('reaction builder matches the HAR-backed mutation variables exactly', () => {
    assert.deepEqual(
        operations.IGDirectReactionSendMutation.buildVariables(
            {
                threadFbid: '340282366841710300949128133551876018644',
                messageId: 'mid.$cAABa-Z8DgqJu9RqQy2iUnYadFQdn',
                emoji: '❤',
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
    assert.equal(Object.keys(operations).length, 35);
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
