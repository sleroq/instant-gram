import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTrustedProfileImageDataUrl } from '../../lib/media-proxy.ts';

test('profile image proxy accepts only bounded Instagram CDN images', async () => {
    let calls = 0;
    const fetchImage: typeof fetch = async () => {
        calls++;
        return new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/jpeg' },
        });
    };
    assert.equal(
        await loadTrustedProfileImageDataUrl('https://scontent.cdninstagram.com/avatar.jpg', fetchImage),
        'data:image/jpeg;base64,AQID',
    );
    await assert.rejects(
        loadTrustedProfileImageDataUrl('https://example.com/avatar.jpg', fetchImage),
        /Untrusted/,
    );
    assert.equal(calls, 1);
});

test('profile image proxy rejects non-images and oversized responses', async () => {
    const source = 'https://scontent.cdninstagram.com/avatar.jpg';
    await assert.rejects(loadTrustedProfileImageDataUrl(source, async () => new Response('no', {
        headers: { 'content-type': 'text/plain' },
    })), /invalid media/);
    await assert.rejects(loadTrustedProfileImageDataUrl(source, async () => new Response('', {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(2 * 1024 * 1024 + 1) },
    })), /too large/);
});
