import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createMotionPreferences,
    MOTION_STORAGE_KEY,
    parseMotionPreference,
} from '../lib/preferences/motion';

function fixture(initial?: unknown) {
    let value = initial;
    const changed = new Set<
        (changes: Record<string, { newValue?: unknown }>, area: string) => void
    >();
    const media = Object.assign(new EventTarget(), { matches: false });
    const storage = {
        local: {
            get: async (): Promise<Record<string, unknown>> => ({
                [MOTION_STORAGE_KEY]: value,
            }),
            set: async (values: Record<string, unknown>) => {
                value = values[MOTION_STORAGE_KEY];
                publish(value);
            },
        },
        onChanged: {
            addListener: (
                listener: typeof changed extends Set<infer T> ? T : never,
            ) => {
                changed.add(listener);
            },
            removeListener: (
                listener: typeof changed extends Set<infer T> ? T : never,
            ) => {
                changed.delete(listener);
            },
        },
    };
    function publish(next: unknown, area = 'local') {
        changed.forEach((listener) =>
            listener({ [MOTION_STORAGE_KEY]: { newValue: next } }, area),
        );
    }
    return { storage, media, changed, publish, value: () => value };
}

test('motion defaults and invalid stored values resolve to System; explicit overrides ignore the OS', async () => {
    for (const value of [
        undefined,
        null,
        false,
        1,
        {},
        'Full',
        'unknown',
        'system',
    ])
        assert.equal(parseMotionPreference(value), 'system');
    const f = fixture({ motion: 'full' });
    f.media.matches = true;
    const owner = createMotionPreferences(f.storage, f.media);
    await owner.ready;
    assert.equal(owner.preference(), 'system');
    assert.equal(owner.effective(), 'reduced');
    await owner.set('full');
    assert.equal(f.value(), 'full');
    assert.equal(owner.effective(), 'full');
    await owner.set('reduced');
    f.media.matches = false;
    f.media.dispatchEvent(new Event('change'));
    assert.equal(owner.effective(), 'reduced');
    owner.dispose();
});

test('System follows live OS changes and persisted changes propagate across windows and dispose immediately', async () => {
    const f = fixture();
    const first = createMotionPreferences(f.storage, f.media);
    const second = createMotionPreferences(f.storage, f.media);
    await Promise.all([first.ready, second.ready]);
    let updates = 0;
    const unsubscribe = second.subscribe(() => updates++);
    f.media.matches = true;
    f.media.dispatchEvent(new Event('change'));
    assert.equal(second.effective(), 'reduced');
    await first.set('full');
    assert.equal(second.preference(), 'full');
    assert.equal(second.effective(), 'full');
    f.publish('reduced', 'sync');
    assert.equal(second.preference(), 'full');
    f.publish(undefined);
    assert.equal(second.preference(), 'system');
    assert.equal(second.effective(), 'reduced');
    unsubscribe();
    const previousUpdates = updates;
    second.dispose();
    f.media.dispatchEvent(new Event('change'));
    await first.set('reduced');
    assert.equal(updates, previousUpdates);
    first.dispose();
    assert.equal(f.changed.size, 0);
});

test('a storage change during hydration wins over the stale read', async () => {
    const f = fixture();
    let complete!: (value: Record<string, unknown>) => void;
    f.storage.local.get = () =>
        new Promise((resolve) => {
            complete = resolve;
        });
    const owner = createMotionPreferences(f.storage, f.media);
    f.publish('reduced');
    complete({ [MOTION_STORAGE_KEY]: 'full' });
    await owner.ready;
    assert.equal(owner.preference(), 'reduced');
    owner.dispose();
});

test('storage errors retain the last effective mode and report a retryable save failure', async () => {
    const f = fixture();
    f.storage.local.get = async () => {
        throw new Error('unavailable');
    };
    f.storage.local.set = async () => {
        throw new Error('unavailable');
    };
    const owner = createMotionPreferences(f.storage, f.media);
    await owner.ready;
    assert.match(owner.error(), /Could not load/);
    await owner.set('reduced');
    assert.equal(owner.preference(), 'system');
    assert.match(owner.error(), /Could not save/);
    owner.dispose();
});

test('rapid choices persist in order, retain keyboard feedback, and clear an earlier error after a successful no-op write', async () => {
    const f = fixture('system');
    const writes: unknown[] = [];
    f.storage.local.set = async (values) => {
        const value = values[MOTION_STORAGE_KEY];
        writes.push(value);
        if (value === 'full') throw new Error('first write failed');
        // System is already stored: browsers need not emit onChanged for a no-op.
    };
    const owner = createMotionPreferences(f.storage, f.media);
    await owner.ready;
    const first = owner.set('full');
    assert.equal(owner.effective(), 'full');
    const second = owner.set('system');
    assert.equal(owner.preference(), 'system');
    await Promise.all([first, second]);
    assert.deepEqual(writes, ['full', 'system']);
    assert.equal(owner.preference(), 'system');
    assert.equal(owner.error(), '');
    owner.dispose();
});

test('pending persistence never retains listeners or delays disposal in Reduced mode', async () => {
    const f = fixture('reduced');
    let finish!: () => void;
    f.storage.local.set = () =>
        new Promise<void>((resolve) => {
            finish = resolve;
        });
    const owner = createMotionPreferences(f.storage, f.media);
    await owner.ready;
    let updates = 0;
    owner.subscribe(() => updates++);
    const save = owner.set('reduced');
    await Promise.resolve();
    owner.dispose();
    assert.equal(f.changed.size, 0);
    const before = updates;
    f.media.dispatchEvent(new Event('change'));
    finish();
    await save;
    assert.equal(updates, before);
});
