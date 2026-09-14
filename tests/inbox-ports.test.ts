import assert from 'node:assert/strict';
import test from 'node:test';
import { isClientCommand } from '../lib/engine/protocol.ts';

test('client command validation accepts only the JSON command vocabulary', () => {
    assert.equal(isClientCommand({ kind: 'subscribe' }), true);
    assert.equal(
        isClientCommand({ kind: 'subscribe', threadId: 'thread-1' }),
        true,
    );
    assert.equal(
        isClientCommand({ kind: 'refresh-history', threadId: 'thread-1' }),
        true,
    );
    assert.equal(
        isClientCommand({ kind: 'subscribe', threadId: undefined }),
        false,
    );
    assert.equal(isClientCommand({ kind: 'refresh', extra: true }), false);
    assert.equal(
        isClientCommand({ kind: 'refresh-history', threadId: '' }),
        false,
    );
    assert.equal(isClientCommand(['refresh']), false);
});
