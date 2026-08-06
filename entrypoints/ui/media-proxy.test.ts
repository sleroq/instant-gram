import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTrustedProfileImageDataUrl } from '../../lib/media-proxy.ts';

test('profile image proxy accepts only bounded Instagram CDN images', async () => {
    let calls = 0;
    const fetchImage: typeof fetch = async (_input, init) => {
        calls++;
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.redirect, 'error');
        assert.equal(init?.referrerPolicy, 'no-referrer');
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

test('profile image proxy rejects redirected responses', async () => {
    const response = new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/jpeg' },
    });
    Object.defineProperty(response, 'redirected', { value: true });

    await assert.rejects(
        loadTrustedProfileImageDataUrl(
            'https://scontent.cdninstagram.com/avatar.jpg',
            async () => response,
        ),
        /redirected/,
    );
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

test('profile image proxy cancels oversized streams without a content length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024));
            controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
            cancelled = true;
        },
    });

    await assert.rejects(
        loadTrustedProfileImageDataUrl(
            'https://scontent.cdninstagram.com/avatar.jpg',
            async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } }),
        ),
        /too large/,
    );
    assert.equal(cancelled, true);
});
