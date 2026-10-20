import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../lib/domain.ts';
import { messageGrouping } from '../entrypoints/ui/message-grouping.ts';

const noon = new Date(2026, 9, 20, 12).getTime();
function text(id: string, minutes: number, senderId = 'peer'): Message {
    return {
        id,
        ts: noon + minutes * 60_000,
        senderId,
        kind: 'text',
        text: id,
    };
}

test('grouping rolls from the immediate predecessor, including exactly five minutes', () => {
    const messages = [text('a', 0), text('b', 5), text('c', 10)];
    assert.equal(messageGrouping(messages[0], undefined).startsGroup, true);
    assert.equal(messageGrouping(messages[1], messages[0]).startsGroup, false);
    assert.equal(messageGrouping(messages[2], messages[1]).startsGroup, false);
    assert.equal(
        messageGrouping(
            { ...text('d', 15), ts: noon + 15 * 60_000 + 1 },
            messages[2],
        ).startsGroup,
        true,
    );
});

test('senders, local dates, activity and system separators break groups', () => {
    assert.equal(
        messageGrouping(text('b', 1, 'other'), text('a', 0)).startsGroup,
        true,
    );
    const midnight = new Date(2026, 9, 21).getTime();
    assert.deepEqual(
        messageGrouping(
            { ...text('b', 0), ts: midnight },
            { ...text('a', 0), ts: midnight - 1 },
        ),
        { startsGroup: true, newDate: true },
    );
    for (const separator of [
        { id: 'activity', ts: noon, kind: 'activity', text: 'Joined' },
        { id: 'system', ts: noon, kind: 'reaction_log', fragment: 'Reacted' },
    ] satisfies Message[]) {
        assert.equal(
            messageGrouping(separator, text('a', 0)).startsGroup,
            true,
        );
        assert.equal(
            messageGrouping(text('b', 1), separator).startsGroup,
            true,
        );
    }
});

test('retained adjacency needs no extra page and settlement keeps individual keys', () => {
    const previous = text('a', 0, 'viewer');
    const pending: Message = {
        ...text('local-key', 1, 'viewer'),
        delivery: { operationId: 'send', status: 'queued', retryable: false },
    };
    const settled: Message = {
        ...pending,
        serverId: 'server-key',
        delivery: {
            operationId: 'send',
            status: 'succeeded',
            retryable: false,
        },
    };
    assert.deepEqual(
        messageGrouping(settled, previous),
        messageGrouping(pending, previous),
    );
    assert.equal(settled.id, pending.id);
    assert.equal(messageGrouping(pending, undefined).startsGroup, true);
    assert.equal(messageGrouping(pending, previous).startsGroup, false);
    assert.equal(messageGrouping(undefined, previous).newDate, false);
});

test('invalid and reversed timestamps never group', () => {
    assert.equal(
        messageGrouping(text('b', -1), text('a', 0)).startsGroup,
        true,
    );
    assert.equal(
        messageGrouping({ ...text('b', 0), ts: NaN }, text('a', 0)).startsGroup,
        true,
    );
});
