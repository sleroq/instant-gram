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
            },
            context,
        ),
        {
            count: 5,
            cursor: 'next',
            folder: 'INBOX',
            newer_than_timestamp_ms: null,
            id: 'viewer-1',
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

test('catalog is a closed DM allowlist', () => {
    assert.equal(Object.keys(operations).length, 29);
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
