import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTAGRAM_GRAPHQL_OPERATIONS } from '../lib/instagram-api/catalog.ts';

const context = { deviceId: 'device-1' };

test('inbox pagination uses the captured generation and exact relay variables', () => {
    const operation =
        INSTAGRAM_GRAPHQL_OPERATIONS.IGDThreadListOffMsysPaginationQuery;
    assert.equal(operation.docId, '28035404249479587');
    assert.deepEqual(
        operation.buildVariables(
            {
                cursor: 'next',
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
