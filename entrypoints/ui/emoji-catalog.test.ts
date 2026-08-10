import assert from 'node:assert/strict';
import test from 'node:test';
import { EMOJI_CATALOG, EMOJI_CATEGORIES } from './emoji-catalog.ts';

test('Unicode Emoji 17 catalog is complete, unique, and keeps late-category sequences', () => {
    assert.equal(EMOJI_CATALOG.length, 3_944);
    assert.equal(new Set(EMOJI_CATALOG.map(([emoji]) => emoji)).size, EMOJI_CATALOG.length);
    assert.deepEqual(
        EMOJI_CATEGORIES.map(({ id, count }) => [id, count]),
        [
            ['smileys-emotion', 171],
            ['people-body', 2_418],
            ['animals-nature', 160],
            ['food-drink', 131],
            ['travel-places', 219],
            ['activities', 85],
            ['objects', 266],
            ['symbols', 224],
            ['flags', 270],
        ],
    );

    const byEmoji = new Map(EMOJI_CATALOG.map(entry => [entry[0], entry]));
    assert.deepEqual(byEmoji.get('🫪'), ['🫪', 'distorted face', 'smileys-emotion']);
    assert.deepEqual(byEmoji.get('🪩'), ['🪩', 'mirror ball', 'activities']);
    assert.deepEqual(byEmoji.get('🪭'), ['🪭', 'folding hand fan', 'objects']);
    assert.deepEqual(byEmoji.get('🟰'), ['🟰', 'heavy equals sign', 'symbols']);
    assert.deepEqual(byEmoji.get('🏴󠁧󠁢󠁷󠁬󠁳󠁿'), ['🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'flag: Wales', 'flags']);
    assert.deepEqual(
        byEmoji.get('🧑🏿‍🤝‍🧑🏻'),
        ['🧑🏿‍🤝‍🧑🏻', 'people holding hands: dark skin tone, light skin tone', 'people-body'],
    );
});
