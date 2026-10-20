import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type { Message, Page, Thread, ThreadMessages } from '../lib/domain.ts';
import { createInboxRepository } from '../lib/engine/db.ts';
import { InboxError, type InboxProjection } from '../lib/engine/inbox.ts';
import type {
    MutationCommand,
    MutationReceipt,
} from '../lib/engine/operations.ts';
import { parseThread } from '../lib/instagram-api/parsers.ts';
import { createInboxEngine } from './engine-fixture.ts';

function deferred<A>() {
    let resolve!: (value: A) => void;
    const promise = new Promise<A>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function message(ts: number): Message {
    return {
        id: `message-${ts}`,
        kind: 'text',
        senderId: 'peer',
        text: 'Test message',
        ts,
    };
}
function thread(id: string, ts: number, pinned = false): Thread {
    return {
        key: id,
        threadFbid: `fb-${id}`,
        threadIgId: `ig-${id}`,
        title: id,
        users: [],
        isGroup: false,
        isMuted: false,
        folder: 'PRIMARY',
        lastActivityMs: ts,
        isUnread: true,
        serverIsPin: pinned,
        lastMessage: message(ts),
    };
}
function detail(ts: number): ThreadMessages {
    // Captured detail responses carry activity but omit the inbox's is_pin field.
    const parsed = parseThread({
        thread_key: 'a',
        thread_fbid: 'fb-a',
        thread_id: 'ig-a',
        last_activity_timestamp_ms: String(ts),
        marked_as_unread: true,
        slide_messages: {
            edges: [
                {
                    node: {
                        id: `message-${ts}`,
                        sender_fbid: 'peer',
                        timestamp_ms: String(ts),
                        content_type: 'TEXT',
                        content: {
                            __typename: 'SlideMessageText',
                            text_body: 'Test message',
                        },
                    },
                },
            ],
        },
    });
    assert(parsed);
    return {
        items: [message(ts)],
        hasNextPage: false,
        viewerId: 'viewer',
        thread: parsed,
    };
}
function readCommand(
    state: InboxProjection,
    operationId: string,
    ts: number,
): MutationCommand {
    assert(state.accountId);
    return {
        accountId: state.accountId,
        accountEpoch: state.accountEpoch,
        operationId,
        intent: {
            type: 'read',
            threadId: 'a',
            messageId: `message-${ts}`,
            timestampMs: ts,
        },
    };
}
function observe(engine: Awaited<ReturnType<typeof createInboxEngine>>) {
    const ready = deferred<void>();
    const emitted: InboxProjection[] = [];
    const watchers = new Set<() => void>();
    engine.subscribe((value) => {
        emitted.push(value);
        if (value.histories.a?.availability === 'present') ready.resolve();
        for (const check of watchers) check();
    }, 'a');
    function until(predicate: (value: InboxProjection) => boolean) {
        if (predicate(engine.snapshot())) return Promise.resolve();
        return new Promise<void>((resolve) => {
            function check() {
                if (predicate(engine.snapshot())) {
                    watchers.delete(check);
                    resolve();
                }
            }
            watchers.add(check);
        });
    }
    return { ready: ready.promise, emitted, until };
}

test('detail refresh and unchanged inbox refresh never remove a pin or temporarily reorder the sidebar', async (t) => {
    const inbox: Page<Thread> = {
        items: [thread('a', 200, true), thread('b', 300)],
        hasNextPage: false,
    };
    const heldInbox = deferred<Page<Thread>>();
    let hold = false;
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        {
            account: async () => 'account',
            inbox: async () => (hold ? heldInbox.promise : inbox),
            history: async () => detail(200),
        },
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.ready;
    assert.equal(engine.snapshot().entities.threadsById.a.serverIsPin, true);

    hold = true;
    const refresh = engine.refresh();
    await engine.refreshHistory('a');
    heldInbox.resolve(inbox);
    await refresh;
    for (const projection of view.emitted.filter(
        (value) => value.inbox.availability === 'present',
    )) {
        assert.deepEqual(projection.inbox.orderedIds, ['a', 'b']);
        assert.equal(projection.entities.threadsById.a.serverIsPin, true);
    }
});

test('older detail cannot downgrade inbox activity; a seen read watermark stays valid when the inbox is ahead', async (t) => {
    const calls: MutationCommand['intent'][] = [];
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        {
            account: async () => 'account',
            inbox: async () => ({
                items: [thread('a', 300), thread('b', 250)],
                hasNextPage: false,
            }),
            history: async () => detail(200),
            mutate: async (_account, request) => {
                calls.push(request.intent);
                assert(request.intent.type === 'read');
                return {
                    type: 'read',
                    threadIgId: 'ig-a',
                    messageId: request.intent.messageId,
                    timestampMs: request.intent.timestampMs,
                };
            },
        },
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.ready;
    assert.equal(engine.snapshot().entities.threadsById.a.lastActivityMs, 300);
    assert.equal(
        engine.snapshot().entities.threadsById.a.lastMessageId,
        'message-300',
    );

    const otherThread = await engine.mutate(
        readCommand(engine.snapshot(), 'wrong-conversation', 250),
    );
    assert(!otherThread.ok);
    assert.equal(calls.length, 0);

    const result = await engine.mutate(
        readCommand(engine.snapshot(), 'seen-before-new-arrival', 200),
    );
    assert(result.ok);
    await view.until(
        (value) =>
            value.entities.threadsById.a.readWatermarkMs === 200 &&
            (value.operations?.length ?? 0) === 0,
    );
    assert.equal(engine.snapshot().entities.threadsById.a.isUnread, true);
    assert.deepEqual(engine.snapshot().inbox.orderedIds, ['a', 'b']);
    assert.equal(calls.length, 1);
});

test('fresh server confirmation settles a failed read without resending it or retaining stale error controls', async (t) => {
    let unread = true;
    let calls = 0;
    const engine = await createInboxEngine(
        createInboxRepository(new IDBFactory()),
        {
            account: async () => 'account',
            inbox: async () => ({
                items: [{ ...thread('a', 200), isUnread: unread }],
                hasNextPage: false,
            }),
            history: async () => detail(200),
            mutate: async (): Promise<MutationReceipt> => {
                calls++;
                throw new InboxError('unknown_outcome');
            },
        },
    );
    t.after(engine.dispose);
    const view = observe(engine);
    await view.ready;
    assert(
        (
            await engine.mutate(
                readCommand(
                    engine.snapshot(),
                    'read-received-but-receipt-lost',
                    200,
                ),
            )
        ).ok,
    );
    await view.until((value) => value.operations?.[0]?.status === 'failed');

    await engine.refresh();
    assert.equal(engine.snapshot().operations?.[0]?.status, 'failed');

    unread = false;
    await engine.refresh();
    const state = engine.snapshot();
    assert.equal(state.entities.threadsById.a.isUnread, false);
    assert.equal(state.entities.threadsById.a.readWatermarkMs, 200);
    assert.equal(state.operations?.length ?? 0, 0);
    assert.equal(calls, 1);
});
