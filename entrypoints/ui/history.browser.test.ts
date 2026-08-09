import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';

let browser: Browser;
let server: ViteDevServer;
let baseUrl: string;

test.before(async () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    server = await createServer({
        root,
        configFile: false,
        server: { port: 0 },
        resolve: {
            alias: {
                'teact/jsx-dev-runtime': fileURLToPath(
                    new URL('../../vendor/teact/src/teact/jsx-runtime.ts', import.meta.url),
                ),
                'teact/jsx-runtime': fileURLToPath(
                    new URL('../../vendor/teact/src/teact/jsx-runtime.ts', import.meta.url),
                ),
                teact: fileURLToPath(new URL('../../vendor/teact/src/teact', import.meta.url)),
            },
        },
    });
    await server.listen();
    baseUrl = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ headless: true });
});

test.after(async () => {
    await browser.close();
    await server.close();
});

test('dark desktop shell keeps floating geometry and exposes its resize separator', async () => {
    const page = await openHarness({ width: 1200, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.chat-row--selected'));
    const result = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const shell = document.querySelector<HTMLElement>('.app-shell')!;
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const header = document.querySelector<HTMLElement>('.conversation__header')!;
        const selected = document.querySelector<HTMLElement>('.chat-row--selected')!;
        const resizeHandle = document.querySelector<HTMLElement>('.sidebar-resize')!;
        const sidebarRect = sidebar.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return {
            colorScheme: root.colorScheme,
            canvasToken: root.getPropertyValue('--color-canvas').trim(),
            selectionToken: root.getPropertyValue('--color-selection').trim(),
            shellOverflowX: shell.scrollWidth - shell.clientWidth,
            sidebar: {
                x: sidebarRect.x,
                y: sidebarRect.y,
                width: sidebarRect.width,
                height: sidebarRect.height,
                radius: getComputedStyle(sidebar).borderRadius,
                shadow: getComputedStyle(sidebar).boxShadow,
                borderWidth: getComputedStyle(sidebar).borderWidth,
                resize: getComputedStyle(sidebar).resize,
            },
            header: {
                radius: getComputedStyle(header).borderRadius,
                x: headerRect.x,
            },
            selectedRadius: getComputedStyle(selected).borderRadius,
            selectedBorderWidth: getComputedStyle(selected).borderWidth,
            resizeHandle: {
                role: resizeHandle.getAttribute('role'),
                orientation: resizeHandle.getAttribute('aria-orientation'),
                value: resizeHandle.getAttribute('aria-valuenow'),
            },
        };
    });
    assert.equal(result.colorScheme, 'dark');
    assert.equal(result.canvasToken, '#0c0a12');
    assert.equal(result.selectionToken, '#382255');
    assert.ok(result.shellOverflowX <= 0);
    assert.deepEqual(
        { x: result.sidebar.x, y: result.sidebar.y, width: result.sidebar.width, height: result.sidebar.height },
        { x: 16, y: 16, width: 390, height: 668 },
    );
    assert.equal(result.sidebar.radius, '24px');
    assert.notEqual(result.sidebar.shadow, 'none');
    assert.equal(result.sidebar.borderWidth, '0px');
    assert.equal(result.sidebar.resize, 'none');
    assert.equal(result.header.radius, '32px');
    assert.ok(result.header.x > result.sidebar.x + result.sidebar.width);
    assert.equal(result.selectedRadius, '16px');
    assert.equal(result.selectedBorderWidth, '0px');
    assert.deepEqual(result.resizeHandle, { role: 'separator', orientation: 'vertical', value: '390' });
    await page.close();
});

test('sidebar resize supports pointer, keyboard, persistence, and compact layout boundaries', async () => {
    const page = await openHarness({ width: 1200, height: 700 });
    await page.evaluate(() => {
        localStorage.removeItem('icr:sidebar-width');
        return window.historyHarness.mount('resize-virtual');
    });
    await page.waitForFunction(() => document.querySelector('.chat-row--selected'));
    const handle = page.getByRole('separator', { name: 'Resize conversation list' });
    const handleBox = await handle.boundingBox();
    assert.ok(handleBox);
    await page.locator('.chat-list').evaluate(list => {
        list.scrollTop = 720;
        list.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() =>
        document.querySelector<HTMLElement>('[data-thread-id]')?.dataset.threadId === 'resize-thread-7');
    const before = await page.evaluate(() => ({
        ids: Array.from(document.querySelectorAll<HTMLElement>('[data-thread-id]'), row => row.dataset.threadId),
        spacerHeight: document.querySelector<HTMLElement>('.chat-list__spacer')!.style.height,
        scrollTop: document.querySelector<HTMLElement>('.chat-list')!.scrollTop,
        rowCount: document.querySelectorAll('[data-thread-id]').length,
    }));
    assert.equal(before.rowCount, 31);
    assert.equal(before.spacerHeight, '4320px');
    assert.equal(before.scrollTop, 720);
    assert.deepEqual(before.ids, Array.from({ length: 31 }, (_, index) => `resize-thread-${index + 7}`));
    await page.evaluate(() => {
        (window as Window & { resizeIdentityRow?: Element }).resizeIdentityRow =
            document.querySelector('[data-thread-id="resize-thread-20"]')!;
    });

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 70, handleBox.y + 80, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 460);
    assert.equal(await handle.getAttribute('aria-valuenow'), '460');
    assert.equal(await page.evaluate(() => localStorage.getItem('icr:sidebar-width')), '460');
    assert.equal(await page.evaluate(() =>
        (window as Window & { resizeIdentityRow?: Element }).resizeIdentityRow ===
            document.querySelector('[data-thread-id="resize-thread-20"]')),
    true);
    assert.deepEqual(await page.evaluate(() => ({
        ids: Array.from(document.querySelectorAll<HTMLElement>('[data-thread-id]'), row => row.dataset.threadId),
        spacerHeight: document.querySelector<HTMLElement>('.chat-list__spacer')!.style.height,
        scrollTop: document.querySelector<HTMLElement>('.chat-list')!.scrollTop,
    })), {
        ids: before.ids,
        spacerHeight: before.spacerHeight,
        scrollTop: before.scrollTop,
    });

    await page.evaluate(() => window.historyHarness.mount('resize-virtual'));
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 460);
    const remountedHandle = page.getByRole('separator', { name: 'Resize conversation list' });
    assert.equal(await remountedHandle.getAttribute('aria-valuenow'), '460');
    await page.locator('.chat-list').evaluate(list => {
        list.scrollTop = 720;
        list.dispatchEvent(new Event('scroll'));
    });
    await page.waitForFunction(() =>
        document.querySelector<HTMLElement>('[data-thread-id]')?.dataset.threadId === 'resize-thread-7');

    await remountedHandle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 450);
    assert.equal(await page.evaluate(() => localStorage.getItem('icr:sidebar-width')), '450');
    assert.deepEqual(await page.evaluate(() => ({
        ids: Array.from(document.querySelectorAll<HTMLElement>('[data-thread-id]'), row => row.dataset.threadId),
        spacerHeight: document.querySelector<HTMLElement>('.chat-list__spacer')!.style.height,
        scrollTop: document.querySelector<HTMLElement>('.chat-list')!.scrollTop,
        rowCount: document.querySelectorAll('[data-thread-id]').length,
        conversationWidth: document.querySelector<HTMLElement>('.conversation')!.getBoundingClientRect().width,
    })), { ...before, conversationWidth: 702 });

    await page.setViewportSize({ width: 850, height: 700 });
    await page.waitForFunction(() =>
        document.querySelector('.sidebar')!.getBoundingClientRect().width === 450 &&
        document.querySelector('.sidebar-resize')!.getAttribute('aria-valuemax') === '482');
    assert.deepEqual(await page.evaluate(() => {
        const resizeHandle = document.querySelector('.sidebar-resize')!;
        return {
            min: resizeHandle.getAttribute('aria-valuemin'),
            max: resizeHandle.getAttribute('aria-valuemax'),
            now: resizeHandle.getAttribute('aria-valuenow'),
        };
    }), { min: '280', max: '482', now: '450' });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedMotion = await page.evaluate(() => ({
        requested: matchMedia('(prefers-reduced-motion: reduce)').matches,
        handleTransitionSeconds: Number.parseFloat(
            getComputedStyle(document.querySelector<HTMLElement>('.sidebar-resize')!, '::after').transitionDuration,
        ),
        shellTransition: getComputedStyle(document.querySelector<HTMLElement>('.app-shell')!).transitionProperty,
    }));
    assert.equal(reducedMotion.requested, true);
    assert.ok(reducedMotion.handleTransitionSeconds <= 0.001);
    assert.ok(!reducedMotion.shellTransition.includes('width'));

    await page.setViewportSize({ width: 600, height: 700 });
    const compact = await page.evaluate(() => ({
        handleDisplay: getComputedStyle(document.querySelector<HTMLElement>('.sidebar-resize')!).display,
        sidebarWidth: document.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect().width,
        conversationWidth: document.querySelector<HTMLElement>('.conversation')!.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        overflow: document.querySelector<HTMLElement>('.app-shell')!.scrollWidth - innerWidth,
    }));
    assert.equal(compact.handleDisplay, 'none');
    assert.equal(compact.sidebarWidth, 0);
    assert.ok(compact.conversationWidth >= compact.viewportWidth - 32);
    assert.equal(compact.overflow, 0);
    await page.setViewportSize({ width: 1200, height: 700 });
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 450);
    assert.equal(await page.evaluate(() => localStorage.getItem('icr:sidebar-width')), '450');
    await page.evaluate(() => localStorage.removeItem('icr:sidebar-width'));
    await page.close();
});

test('sidebar resize cleanup handles lost capture and unmount idempotently', async () => {
    const page = await openHarness({ width: 1200, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    const handle = page.getByRole('separator', { name: 'Resize conversation list' });
    const box = await handle.boundingBox();
    assert.ok(box);
    await handle.evaluate(element => {
        element.addEventListener('pointerdown', event => {
            (element as HTMLElement).dataset.activePointerId = String((event as PointerEvent).pointerId);
        });
    });

    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), true);
    await handle.evaluate(element => element.dispatchEvent(new PointerEvent('lostpointercapture', {
        bubbles: false,
        pointerId: Number((element as HTMLElement).dataset.activePointerId),
    })));
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), false);
    await page.mouse.up();

    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), true);
    await handle.evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId: Number((element as HTMLElement).dataset.activePointerId),
    })));
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), false);
    await page.mouse.up();

    await page.mouse.move(box.x + box.width / 2, box.y + 120);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), true);
    await page.evaluate(() => window.historyHarness.mount('resize'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-resizing-sidebar')), false);
    await page.mouse.up();
    await page.close();
});

test('unavailable preference storage does not block sidebar mount or interaction', async () => {
    const page = await openHarness({ width: 1200, height: 700 });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluate(() => {
        localStorage.clear();
        Storage.prototype.getItem = () => { throw new Error('storage read denied'); };
        Storage.prototype.setItem = () => { throw new Error('storage write denied'); };
        Storage.prototype.removeItem = () => { throw new Error('storage remove denied'); };
        return window.historyHarness.mount('resize');
    });
    const handle = page.getByRole('separator', { name: 'Resize conversation list' });
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 400);
    await handle.dblclick();
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().width === 390);
    assert.deepEqual(pageErrors, []);
    await page.close();
});

test('image messages render with reserved geometry and a useful inbox summary', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('image'));
    await page.waitForFunction(() => document.querySelector('.message-images img'));
    const result = await page.evaluate(() => {
        const image = document.querySelector<HTMLImageElement>('.message-images img')!;
        return {
            width: image.getAttribute('width'),
            height: image.getAttribute('height'),
            alt: image.alt,
            summary: document.querySelector('.chat-row__snippet')?.textContent,
        };
    });
    assert.deepEqual(result, {
        width: '430',
        height: '960',
        alt: 'Shared image',
        summary: 'Photo',
    });
    await page.close();
});

test('delayed reel metadata updates inline ratio without moving the history anchor', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('reel-delayed'));
    const previewMedia = page.locator('.message-reel-preview__media');
    await previewMedia.waitFor();
    const anchor = page.locator('[data-message-id="m30"]');
    await anchor.scrollIntoViewIfNeeded();
    await anchor.focus();
    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const anchorRow = document.querySelector<HTMLElement>('[data-message-id="m30"]')!;
        const preview = document.querySelector<HTMLElement>('.message-reel-preview__media')!;
        const media = preview.querySelector<HTMLElement>('img, video')!;
        const previewRect = preview.getBoundingClientRect();
        const mediaRect = media.getBoundingClientRect();
        return {
            anchorTop: anchorRow.getBoundingClientRect().top,
            ratio: previewRect.width / previewRect.height,
            width: previewRect.width,
            height: previewRect.height,
            media: { width: mediaRect.width, height: mediaRect.height },
            objectFit: getComputedStyle(media).objectFit,
            overflows: preview.scrollWidth > preview.clientWidth || preview.scrollHeight > preview.clientHeight,
            viewportIds: window.historyHarness.historyState('thread').viewportIds,
            calls: window.historyHarness.calls(),
            rows: document.querySelectorAll('[data-message-id]').length,
        };
    });
    assert.ok(Math.abs(before.width - 150) < 0.1);
    assert.ok(Math.abs(before.height - 300) < 0.1);
    assert.deepEqual(before.media, { width: before.width, height: before.height });
    assert.equal(before.objectFit, 'contain');
    assert.equal(before.overflows, false);

    await page.evaluate(() => window.historyHarness.resolveReelMedia());
    await page.waitForFunction(() => {
        const media = document.querySelector<HTMLElement>('.message-reel-preview__media');
        return media?.querySelector('video') && media.getBoundingClientRect().width / media.getBoundingClientRect().height > 1.7;
    });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
        const anchorRow = document.querySelector<HTMLElement>('[data-message-id="m30"]')!;
        const preview = document.querySelector<HTMLElement>('.message-reel-preview__media')!;
        const media = preview.querySelector<HTMLElement>('img, video')!;
        const previewRect = preview.getBoundingClientRect();
        const mediaRect = media.getBoundingClientRect();
        return {
            anchorTop: anchorRow.getBoundingClientRect().top,
            ratio: previewRect.width / previewRect.height,
            width: previewRect.width,
            height: previewRect.height,
            media: { width: mediaRect.width, height: mediaRect.height },
            objectFit: getComputedStyle(media).objectFit,
            overflows: preview.scrollWidth > preview.clientWidth || preview.scrollHeight > preview.clientHeight,
            source: preview.querySelector('video')?.getAttribute('src'),
            focusedId: document.activeElement?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId,
            viewportIds: window.historyHarness.historyState('thread').viewportIds,
            calls: window.historyHarness.calls(),
            rows: document.querySelectorAll('[data-message-id]').length,
        };
    });
    assert.ok(Math.abs(after.ratio - 16 / 9) < 0.01);
    assert.ok(after.width > before.width && after.width <= 300);
    assert.ok(Math.abs(after.height - after.width * 9 / 16) < 0.1);
    assert.deepEqual(after.media, { width: after.width, height: after.height });
    assert.equal(after.objectFit, 'contain');
    assert.equal(after.overflows, false);
    assert.match(after.source ?? '', /^data:video\/mp4/);
    assert.ok(Math.abs(after.anchorTop - before.anchorTop) < 1);
    assert.equal(after.focusedId, 'm30');
    assert.deepEqual(after.viewportIds, before.viewportIds);
    assert.deepEqual(after.calls, before.calls);
    assert.ok(after.rows <= 80);
    await page.close();
});

test('reel preview and modal own playback, carousel, actions, comments, links, and focus', async () => {
    const page = await openHarness({ width: 1100, height: 760 });
    await page.evaluate(() => {
        localStorage.removeItem('icr:reel-volume');
        return window.historyHarness.mount('reel');
    });
    const preview = page.getByRole('button', { name: 'Open reel from reel_author' });
    await preview.waitFor();
    assert.equal(await page.locator('[data-message-id="reel-message"] a[href*="/reel/"]').count(), 0);
    const inlineGeometry = await page.locator('.message-reel-preview__media').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const video = element.querySelector('video')!;
        const mediaRect = video.getBoundingClientRect();
        const cardRect = element.closest('.message-reel-preview')!.getBoundingClientRect();
        return {
            ratio: rect.width / rect.height,
            box: { width: rect.width, height: rect.height },
            media: { width: mediaRect.width, height: mediaRect.height },
            cardWidth: cardRect.width,
            width: video.getAttribute('width'),
            height: video.getAttribute('height'),
        };
    });
    assert.ok(Math.abs(inlineGeometry.ratio - 9 / 16) < 0.01);
    assert.deepEqual(inlineGeometry.box, { width: 168.75, height: 300 });
    assert.deepEqual(inlineGeometry.media, inlineGeometry.box);
    assert.equal(inlineGeometry.cardWidth, inlineGeometry.box.width);
    assert.deepEqual({ width: inlineGeometry.width, height: inlineGeometry.height }, {
        width: '540', height: '960',
    });
    assert.match(
        await page.locator('[data-message-id="reel-message"] .shared-post__author-avatar img').getAttribute('src') ?? '',
        /^data:image\/gif;base64,/,
    );
    const sharedPost = page.locator('[data-message-id="reel-message"]');
    const sharedLayout = await sharedPost.evaluate(element => {
        const bubble = element.querySelector<HTMLElement>('.message__bubble')!;
        const media = element.querySelector<HTMLElement>('.message-reel-preview')!.getBoundingClientRect();
        const reactions = element.querySelector<HTMLElement>('.message__reactions')!.getBoundingClientRect();
        const time = element.querySelector<HTMLElement>('.message__body > time')!;
        const style = getComputedStyle(bubble);
        return {
            background: style.backgroundColor,
            padding: style.padding,
            reactionBelow: reactions.top >= media.bottom,
            timeOpacity: getComputedStyle(time).opacity,
        };
    });
    assert.equal(sharedLayout.background, 'rgba(0, 0, 0, 0)');
    assert.equal(sharedLayout.padding, '0px');
    assert.equal(sharedLayout.reactionBelow, true);
    assert.equal(sharedLayout.timeOpacity, '0');
    await sharedPost.hover();
    await page.waitForFunction(() => getComputedStyle(
        document.querySelector('[data-message-id="reel-message"] .message__body > time')!,
    ).opacity === '1');

    const otherReaction = sharedPost.getByRole('button', { name: 'Add 🔥 reaction, 1 reaction' });
    await otherReaction.click();
    await page.waitForFunction(() => document.querySelector(
        '[data-message-id="reel-message"] .reaction-chip--viewer',
    )?.textContent?.includes('🔥'));
    assert.deepEqual((await page.evaluate(() => window.historyHarness.reactionCalls())).at(-1), {
        threadFbid: '1001', messageId: 'reel-message', emoji: '🔥', remove: false,
    });
    await sharedPost.getByRole('button', { name: 'Remove your 🔥 reaction, 1 reaction' }).click();
    await page.waitForFunction(() => !document.querySelector(
        '[data-message-id="reel-message"] .reaction-chip--viewer',
    ));
    assert.deepEqual((await page.evaluate(() => window.historyHarness.reactionCalls())).at(-1), {
        threadFbid: '1001', messageId: 'reel-message', emoji: '🔥', remove: true,
    });

    const inlinePlayback = await page.locator('.message-reel-preview video').evaluate(async video => {
        const playback = { plays: 0, pauses: 0 };
        Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => { playback.plays++; return Promise.resolve(); } });
        Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => { playback.pauses++; } });
        video.scrollIntoView({ block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 350));
        const scroller = video.closest('.messages')!;
        const beforeLoad = {
            scrollTop: scroller.scrollTop,
            top: video.getBoundingClientRect().top,
            height: video.getBoundingClientRect().height,
        };
        video.dispatchEvent(new Event('canplay'));
        await new Promise(resolve => setTimeout(resolve, 200));
        const afterLoad = {
            scrollTop: scroller.scrollTop,
            top: video.getBoundingClientRect().top,
            height: video.getBoundingClientRect().height,
        };
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise(resolve => setTimeout(resolve, 80));
        const afterVisible = { ...playback };
        const row = video.closest('.message-reel-preview') as HTMLElement;
        row.style.display = 'none';
        scroller.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => setTimeout(resolve, 350));
        const afterHidden = { ...playback };
        row.style.display = '';
        return { beforeLoad, afterLoad, afterVisible, afterHidden };
    });
    assert.ok(Math.abs(inlinePlayback.afterLoad.scrollTop - inlinePlayback.beforeLoad.scrollTop) < 1);
    assert.ok(Math.abs(inlinePlayback.afterLoad.top - inlinePlayback.beforeLoad.top) < 1);
    assert.ok(Math.abs(inlinePlayback.afterLoad.height - inlinePlayback.beforeLoad.height) < 1);
    assert.equal(inlinePlayback.afterVisible.plays, 0, `history preview autoplayed: ${JSON.stringify(inlinePlayback)}`);
    assert.equal(inlinePlayback.afterHidden.plays, 0, `hidden history preview autoplayed: ${JSON.stringify(inlinePlayback)}`);

    const historyScrollBeforeModal = await page.locator('.messages').evaluate(element => element.scrollTop);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(value: string) {
                    document.documentElement.dataset.copiedModalPostUrl = value;
                    return Promise.resolve();
                },
            },
        });
    });
    await preview.click();
    const dialog = page.getByRole('dialog', { name: 'Reel by Reel Author' });
    await dialog.waitFor();
    await page.getByRole('alert').filter({ hasText: 'Harness comments failure' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.historyHarness.reelMetrics()), {
        reelCommentCalls: 1, reelMediaCalls: 1, reelLikeCalls: 0, reelSaveCalls: 0,
    });
    await page.getByRole('button', { name: 'Retry comments' }).click();
    await page.getByText('Great reel').waitFor();

    const author = page.getByRole('link', { name: /Reel Author/ });
    assert.equal(await author.getAttribute('href'), 'https://www.instagram.com/reel_author/');
    const download = page.getByRole('link', { name: 'Download' });
    assert.ok(await download.getAttribute('download') !== null);
    assert.equal(await download.locator('svg').count(), 1);
    assert.equal((await download.textContent())?.trim(), '');
    assert.equal(await page.getByRole('slider', { name: 'Seek reel' }).count(), 1);
    const copyPost = page.getByRole('button', { name: 'Copy post URL' });
    assert.equal(await copyPost.locator('svg').count(), 1);
    assert.equal((await copyPost.textContent())?.trim(), '');
    await copyPost.click();
    assert.equal(
        await page.locator('html').getAttribute('data-copied-modal-post-url'),
        'https://www.instagram.com/reel/reel-code/',
    );

    const save = page.getByRole('button', { name: 'Save reel' });
    assert.equal(await save.locator('svg').count(), 1);
    assert.equal((await save.textContent())?.trim(), '');
    await page.getByRole('button', { name: 'Like reel' }).click();
    await save.click();
    await page.waitForFunction(() => {
        const metrics = window.historyHarness.reelMetrics();
        return metrics.reelLikeCalls === 1 && metrics.reelSaveCalls === 1;
    });
    assert.equal(await page.getByRole('button', { name: 'Unlike reel' }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: 'Unsave reel' }).getAttribute('aria-pressed'), 'true');

    const modalVideo = page.locator('.reel-stage video');
    const portraitRect = await page.locator('.reel-media').boundingBox();
    assert.ok(portraitRect && Math.abs(portraitRect.width / portraitRect.height - 9 / 16) < 0.01);
    await page.getByRole('button', { name: 'Enter fullscreen' }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('reel-media'));
    const fullscreenGeometry = await modalVideo.evaluate(video => {
        const wrapper = video.parentElement!.getBoundingClientRect();
        const style = getComputedStyle(video);
        return {
            wrapper: { width: wrapper.width, height: wrapper.height },
            viewport: { width: innerWidth, height: innerHeight },
            objectFit: style.objectFit,
        };
    });
    assert.deepEqual(fullscreenGeometry.wrapper, fullscreenGeometry.viewport);
    assert.equal(fullscreenGeometry.objectFit, 'contain');
    await page.getByRole('button', { name: 'Exit fullscreen' }).click();
    await page.waitForFunction(() => document.fullscreenElement === null);
    await modalVideo.evaluate(video => {
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
        Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
        (video as HTMLVideoElement).currentTime = 4;
        (video as HTMLVideoElement).volume = 0.4;
        (video as HTMLVideoElement).muted = true;
        (video as HTMLVideoElement).playbackRate = 1.5;
    });
    await page.getByRole('combobox', { name: 'Reel quality' }).selectOption('1');
    await page.waitForTimeout(100);
    await modalVideo.dispatchEvent('loadedmetadata');
    const switched = await modalVideo.evaluate(video => ({
        src: (video as HTMLVideoElement).getAttribute('src'),
        time: (video as HTMLVideoElement).currentTime,
        volume: (video as HTMLVideoElement).volume,
        muted: (video as HTMLVideoElement).muted,
        rate: (video as HTMLVideoElement).playbackRate,
    }));
    assert.match(switched.src ?? '', /AAAA$/);
    assert.ok(Math.abs(switched.time - 4) < 0.01);
    assert.equal(switched.volume, 0.4);
    assert.equal(switched.muted, true);
    assert.equal(switched.rate, 1.5);
    await modalVideo.evaluate(video => { (video as HTMLVideoElement).playbackRate = 1; });

    await page.keyboard.down('Space');
    await page.waitForTimeout(275);
    assert.equal(await modalVideo.evaluate(video => (video as HTMLVideoElement).playbackRate), 2);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await modalVideo.evaluate(video => (video as HTMLVideoElement).playbackRate), 1);
    await page.keyboard.up('Space');
    await modalVideo.evaluate(video => {
        Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
        (video as HTMLVideoElement).currentTime = 1;
    });
    await page.keyboard.press(',');
    assert.ok(Math.abs(await modalVideo.evaluate(video => (video as HTMLVideoElement).currentTime) - (1 - 1 / 30)) < 0.002);
    await page.keyboard.press('.');
    assert.ok(Math.abs(await modalVideo.evaluate(video => (video as HTMLVideoElement).currentTime) - 1) < 0.002);

    await page.getByRole('button', { name: 'Close reel' }).focus();
    await page.keyboard.press('Shift+Tab');
    const focusWrapped = await dialog.evaluate(currentDialog => {
        const focusable = [...currentDialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )];
        return document.activeElement === focusable.at(-1);
    });
    assert.equal(focusWrapped, true);
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(currentDialog =>
        document.activeElement === currentDialog.querySelector<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        )), true);

    await modalVideo.evaluate(video => {
        Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    });
    const oldVideo = await modalVideo.elementHandle();
    await page.keyboard.down('Space');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 2 of 4');
    assert.equal(await oldVideo!.evaluate(video => (video as HTMLVideoElement).playbackRate), 1);
    await page.keyboard.up('Space');
    assert.equal(await page.locator('.reel-stage img[alt="Reel image"]').count(), 1);
    const squareRect = await page.locator('.reel-media').boundingBox();
    assert.ok(squareRect && Math.abs(squareRect.width / squareRect.height - 1) < 0.01);
    assert.equal(await download.getAttribute('href'), 'https://cdn.example/image.jpg');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 3 of 4');
    const landscapeRect = await page.locator('.reel-media').boundingBox();
    assert.ok(landscapeRect && Math.abs(landscapeRect.width / landscapeRect.height - 16 / 9) < 0.01);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.getByRole('slider', { name: 'Reel volume' }).fill('0.35');
    assert.equal(await page.evaluate(() => localStorage.getItem('icr:reel-volume')), '{"volume":0.35,"muted":false}');
    await page.getByRole('button', { name: 'Close reel' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open reel from reel_author');
    assert.equal(await page.locator('.messages').evaluate(element => element.scrollTop), historyScrollBeforeModal);

    await preview.click();
    await dialog.waitFor();
    await page.waitForTimeout(100);
    const closingVideo = page.locator('.reel-stage video');
    assert.equal(await closingVideo.evaluate(video => (video as HTMLVideoElement).volume), 0.35);
    assert.equal(await closingVideo.evaluate(video => (video as HTMLVideoElement).muted), false);
    await page.getByRole('button', { name: 'Mute reel' }).click();
    await closingVideo.evaluate(video => Object.defineProperty(video, 'paused', { configurable: true, get: () => false }));
    const closingHandle = await closingVideo.elementHandle();
    await page.keyboard.down('Space');
    await page.getByRole('button', { name: 'Close reel' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await closingHandle!.evaluate(video => (video as HTMLVideoElement).playbackRate), 1);
    await page.keyboard.up('Space');

    await preview.click();
    await dialog.waitFor();
    assert.equal(await page.locator('.reel-stage video').evaluate(video => (video as HTMLVideoElement).volume), 0.35);
    assert.equal(await page.locator('.reel-stage video').evaluate(video => (video as HTMLVideoElement).muted), true);
    await page.locator('.reel-modal').evaluate(backdrop => {
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open reel from reel_author');
    await page.close();
});

test('portrait reel preview narrows as one bounded media box on compact screens', async () => {
    const page = await openHarness({ width: 320, height: 640 });
    await page.evaluate(() => window.historyHarness.mount('reel'));
    const media = page.locator('.message-reel-preview__media');
    await media.waitFor();
    const geometry = await media.evaluate(element => {
        const box = element.getBoundingClientRect();
        const video = element.querySelector('video')!.getBoundingClientRect();
        return {
            box: { width: box.width, height: box.height },
            video: { width: video.width, height: video.height },
            cardWidth: element.closest('.message-reel-preview')!.getBoundingClientRect().width,
            viewportWidth: innerWidth,
            pageOverflows: document.documentElement.scrollWidth > innerWidth,
            messageOverflows: element.closest<HTMLElement>('.message')!.scrollWidth >
                element.closest<HTMLElement>('.message')!.clientWidth,
        };
    });
    assert.equal(geometry.viewportWidth, 320);
    assert.ok(geometry.box.width <= 300 && geometry.box.height <= 300, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.box.width / geometry.box.height - 9 / 16) < 0.01, JSON.stringify(geometry));
    assert.deepEqual(geometry.video, geometry.box);
    assert.equal(geometry.cardWidth, geometry.box.width);
    assert.equal(geometry.pageOverflows, false);
    assert.equal(geometry.messageOverflows, false);
    await page.close();
});

test('post carousel and soundtrack follow native playback state and clean up on close', async () => {
    const page = await openHarness({ width: 600, height: 700 });
    await page.evaluate(async () => {
        Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
            configurable: true,
            get() { return (this as HTMLElement).dataset.testPaused !== 'false'; },
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'load', {
            configurable: true,
            value() { /* The test drives metadata readiness explicitly. */ },
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
            configurable: true,
            value(this: HTMLMediaElement) {
                this.dataset.playCalls = String(Number(this.dataset.playCalls ?? 0) + 1);
                if (this.tagName === 'AUDIO' && this.dataset.playCalls === '1') return Promise.reject(new Error('Autoplay blocked'));
                this.dataset.testPaused = 'false';
                this.dispatchEvent(new Event('play'));
                return Promise.resolve();
            },
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
            configurable: true,
            value(this: HTMLMediaElement) {
                this.dataset.testPaused = 'true';
                this.dataset.pauseCalls = String(Number(this.dataset.pauseCalls ?? 0) + 1);
                this.dispatchEvent(new Event('pause'));
            },
        });
        await window.historyHarness.mount('post');
    });

    const row = page.locator('[data-message-id="post-message"]');
    await row.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Post by Post Author' });
    await dialog.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Previous slide' }).count(), 0);
    assert.equal(await page.locator('.reel-stage img[alt="Post image"]').getAttribute('src'),
        'data:image/gif;base64,R0lGODlhAQABAAAAACw=first');
    assert.equal(await page.getByRole('button', { name: 'Save post' }).count(), 1);

    const compactGeometry = await page.evaluate(() => {
        const dialogRect = document.querySelector<HTMLElement>('.reel-modal__dialog')!.getBoundingClientRect();
        const stageRect = document.querySelector<HTMLElement>('.reel-stage')!.getBoundingClientRect();
        const detailsRect = document.querySelector<HTMLElement>('.reel-details')!.getBoundingClientRect();
        return {
            dialog: { top: dialogRect.top, bottom: dialogRect.bottom },
            stage: { top: stageRect.top, bottom: stageRect.bottom },
            details: { top: detailsRect.top, bottom: detailsRect.bottom },
            viewportHeight: innerHeight,
        };
    });
    assert.ok(compactGeometry.stage.top >= compactGeometry.dialog.top - 0.5, JSON.stringify(compactGeometry));
    assert.ok(compactGeometry.stage.bottom <= compactGeometry.details.top + 0.5, JSON.stringify(compactGeometry));
    assert.ok(compactGeometry.details.bottom <= compactGeometry.dialog.bottom + 0.5, JSON.stringify(compactGeometry));
    assert.ok(compactGeometry.dialog.bottom <= compactGeometry.viewportHeight + 0.5, JSON.stringify(compactGeometry));

    const audio = page.locator('.reel-stage audio');
    await audio.dispatchEvent('loadedmetadata');
    const playMusic = page.getByRole('button', { name: 'Play post music' });
    await playMusic.waitFor();
    const pausedStatus = page.getByRole('status').filter({ hasText: 'Post music is paused' });
    await pausedStatus.waitFor();
    assert.equal(await pausedStatus.count(), 1);
    assert.equal(await audio.getAttribute('data-play-calls'), '1');
    assert.equal(await audio.evaluate(element => (element as HTMLAudioElement).muted), false);

    await playMusic.click();
    const muteMusic = page.getByRole('button', { name: 'Mute post music' });
    await muteMusic.waitFor();
    assert.equal(await audio.getAttribute('data-play-calls'), '2', 'recovery should play before changing mute state');
    assert.equal(await audio.evaluate(element => (element as HTMLAudioElement).muted), false);
    assert.equal(await muteMusic.getAttribute('aria-pressed'), 'false');
    await muteMusic.click();
    const unmuteMusic = page.getByRole('button', { name: 'Unmute post music' });
    await unmuteMusic.waitFor();
    assert.equal(await audio.evaluate(element => (element as HTMLAudioElement).muted), true);
    assert.equal(await unmuteMusic.getAttribute('aria-pressed'), 'true');

    await audio.evaluate(element => { element.dataset.soundtrackNode = 'original'; });
    const audioHandle = await audio.elementHandle();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 2 of 3');
    assert.equal(await page.locator('.reel-stage video').getAttribute('src'), 'data:video/mp4;base64,AAAA');
    assert.equal(await page.locator('.reel-stage video').evaluate(element => (element as HTMLVideoElement).muted), true);
    assert.equal(await page.getByRole('slider', { name: 'Seek post' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Play post' }).count(), 1);
    assert.equal(await page.getByRole('slider', { name: 'Post volume' }).count(), 0);
    assert.equal(await audio.getAttribute('data-soundtrack-node'), 'original',
        'soundtrack should remain mounted across carousel slides');
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 3 of 3');
    assert.equal(await page.locator('.reel-stage img[alt="Post image"]').getAttribute('src'),
        'data:image/gif;base64,R0lGODlhAQABAAAAACw=third');
    assert.equal(await page.getByRole('button', { name: 'Next slide' }).count(), 0);

    await page.locator('.reel-stage img[alt="Post image"]').dispatchEvent('error');
    await page.getByRole('button', { name: 'Retry post media' }).click();
    await page.waitForFunction(() => window.historyHarness.reelMetrics().reelMediaCalls === 2);
    await page.waitForFunction(() => document.querySelector('.reel-stage audio')?.getAttribute('src')?.endsWith('#refresh-2'));
    await audio.dispatchEvent('loadedmetadata');
    assert.equal(await audio.getAttribute('data-soundtrack-node'), 'original',
        'renewing the soundtrack URL should reinitialize, not remount, its player');
    assert.equal(await audio.getAttribute('data-pause-calls'), '1', 'the replaced source should be paused before reinitializing');
    assert.equal(await audio.getAttribute('data-play-calls'), '3', 'the replacement source should start once');

    await page.getByRole('button', { name: 'Close post' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await audioHandle!.getAttribute('data-pause-calls'), '2');
    await page.close();
});

test('compact reel modal resets aspect-derived stage height', async () => {
    const page = await openHarness({ width: 600, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('reel'));
    await page.getByRole('button', { name: 'Open reel from reel_author' }).click();
    await page.getByRole('dialog', { name: 'Reel by Reel Author' }).waitFor();
    const geometry = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>('.reel-stage')!.getBoundingClientRect();
        const details = document.querySelector<HTMLElement>('.reel-details')!.getBoundingClientRect();
        return { stageBottom: stage.bottom, detailsTop: details.top, stageHeight: stage.height };
    });
    assert.ok(geometry.stageHeight > 0 && geometry.stageBottom <= geometry.detailsTop + 0.5, JSON.stringify(geometry));
    await page.close();
});

test('extreme finite reel ratios keep both production media axes renderable', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('reel-extremes'));
    const previews = page.locator('.message-reel-preview__media');
    await previews.nth(1).waitFor();

    const geometries = await previews.evaluateAll(elements => elements.map(element => {
        const wrapper = element.getBoundingClientRect();
        const mediaElement = element.querySelector<HTMLElement>('img, video')!;
        const media = mediaElement.getBoundingClientRect();
        return {
            wrapper: { width: wrapper.width, height: wrapper.height },
            media: { width: media.width, height: media.height },
            aspectRatio: (element as HTMLElement).style.aspectRatio,
            overflows: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
        };
    }));

    assert.equal(geometries.length, 2);
    assert.ok(geometries[0].wrapper.width < geometries[0].wrapper.height, JSON.stringify(geometries[0]));
    assert.ok(geometries[1].wrapper.width > geometries[1].wrapper.height, JSON.stringify(geometries[1]));
    assert.deepEqual(geometries.map(({ aspectRatio }) => aspectRatio), ['1 / 300', '300 / 1']);
    for (const geometry of geometries) {
        assert.ok(geometry.wrapper.width > 0 && geometry.wrapper.height > 0, JSON.stringify(geometry));
        assert.ok(geometry.wrapper.width <= 300 && geometry.wrapper.height <= 300, JSON.stringify(geometry));
        assert.deepEqual(geometry.media, geometry.wrapper);
        assert.equal(geometry.overflows, false);
    }
    await page.close();
});

test('short landscape reel modal contains every native ratio and keeps controls reachable', async () => {
    const page = await openHarness({ width: 700, height: 480 });
    await page.evaluate(() => window.historyHarness.mount('reel'));
    await page.getByRole('button', { name: 'Open reel from reel_author' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reel by Reel Author' });
    await dialog.waitFor();

    const assertContained = async (ratio: number) => {
        const geometry = await page.evaluate(() => {
            const dialogElement = document.querySelector<HTMLElement>('.reel-modal__dialog')!;
            const stage = document.querySelector<HTMLElement>('.reel-stage')!;
            const media = document.querySelector<HTMLElement>('.reel-media')!;
            const dialogRect = dialogElement.getBoundingClientRect();
            const stageRect = stage.getBoundingClientRect();
            const mediaRect = media.getBoundingClientRect();
            return {
                dialogRect: { top: dialogRect.top, left: dialogRect.left, right: dialogRect.right, bottom: dialogRect.bottom },
                stageRect: { top: stageRect.top, left: stageRect.left, right: stageRect.right, bottom: stageRect.bottom },
                mediaRect: { top: mediaRect.top, left: mediaRect.left, right: mediaRect.right, bottom: mediaRect.bottom, width: mediaRect.width, height: mediaRect.height },
                viewport: { width: innerWidth, height: innerHeight },
                pageOverflows: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
                dialogOverflowsX: dialogElement.scrollWidth > dialogElement.clientWidth,
            };
        });
        assert.ok(
            Math.abs(geometry.mediaRect.width / geometry.mediaRect.height - ratio) < 0.01,
            `unexpected media geometry: ${JSON.stringify({ ratio, geometry })}`,
        );
        assert.ok(geometry.mediaRect.left >= geometry.stageRect.left - 0.5);
        assert.ok(geometry.mediaRect.right <= geometry.stageRect.right + 0.5);
        assert.ok(geometry.mediaRect.top >= geometry.stageRect.top - 0.5);
        assert.ok(geometry.mediaRect.bottom <= geometry.stageRect.bottom + 0.5);
        assert.ok(Math.abs(geometry.mediaRect.width - (geometry.stageRect.right - geometry.stageRect.left)) < 1);
        assert.ok(Math.abs(geometry.mediaRect.height - (geometry.stageRect.bottom - geometry.stageRect.top)) < 1);
        assert.ok(geometry.dialogRect.left >= 0 && geometry.dialogRect.top >= 0);
        assert.ok(geometry.dialogRect.right <= geometry.viewport.width && geometry.dialogRect.bottom <= geometry.viewport.height);
        assert.equal(geometry.pageOverflows, false);
        assert.equal(geometry.dialogOverflowsX, false);
    };

    await assertContained(9 / 16);
    assert.equal(await page.getByRole('slider', { name: 'Seek reel' }).count(), 1);
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 2 of 4');
    await assertContained(1);
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 3 of 4');
    await assertContained(16 / 9);
    await page.getByRole('button', { name: 'Like reel' }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('button', { name: 'Like reel' }).isVisible(), true);
    await page.close();
});

test('tall reel modal keeps custom video controls inside the capped stage', async () => {
    const page = await openHarness({ width: 1200, height: 1000 });
    await page.evaluate(() => window.historyHarness.mount('reel'));
    await page.getByRole('button', { name: 'Open reel from reel_author' }).click();
    await page.getByRole('dialog', { name: 'Reel by Reel Author' }).waitFor();
    await page.waitForTimeout(220);

    const geometry = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('.reel-modal__dialog')!.getBoundingClientRect();
        const stage = document.querySelector<HTMLElement>('.reel-stage')!.getBoundingClientRect();
        const player = document.querySelector<HTMLElement>('.reel-player')!.getBoundingClientRect();
        return {
            viewport: { width: innerWidth, height: innerHeight },
            dialog: { top: dialog.top, bottom: dialog.bottom },
            stage: { top: stage.top, bottom: stage.bottom },
            player: { top: player.top, bottom: player.bottom, width: player.width, height: player.height },
        };
    });

    assert.ok(geometry.player.width > 0 && geometry.player.height > 0, JSON.stringify(geometry));
    assert.ok(geometry.player.top >= geometry.stage.top, JSON.stringify(geometry));
    assert.ok(geometry.player.bottom <= geometry.stage.bottom, JSON.stringify(geometry));
    assert.ok(geometry.stage.top >= geometry.dialog.top, JSON.stringify(geometry));
    assert.ok(geometry.stage.bottom <= geometry.dialog.bottom, JSON.stringify(geometry));
    assert.ok(geometry.player.bottom <= geometry.viewport.height, JSON.stringify(geometry));
    assert.equal(await page.getByRole('slider', { name: 'Seek reel' }).isVisible(), true);
    await page.close();
});

test('reel playback remembers each video and separates Space taps from holds', async () => {
    const page = await openHarness({ width: 1100, height: 760 });
    await page.evaluate(() => {
        Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
            configurable: true,
            get() { return (this as HTMLElement).dataset.testPaused !== 'false'; },
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
            configurable: true,
            value(this: HTMLMediaElement) {
                this.dataset.testPaused = 'false';
                this.dataset.playCalls = String(Number(this.dataset.playCalls ?? 0) + 1);
                this.dispatchEvent(new Event('play'));
                return Promise.resolve();
            },
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
            configurable: true,
            value(this: HTMLMediaElement) {
                this.dataset.testPaused = 'true';
                this.dataset.pauseCalls = String(Number(this.dataset.pauseCalls ?? 0) + 1);
                this.dispatchEvent(new Event('pause'));
            },
        });
        window.historyHarness.mount('reel');
    });

    const preview = page.getByRole('button', { name: 'Open reel from reel_author' });
    const dialog = page.getByRole('dialog', { name: 'Reel by Reel Author' });
    await preview.click();
    await dialog.waitFor();
    let video = page.locator('.reel-stage video');
    await page.waitForTimeout(50);
    await video.dispatchEvent('loadedmetadata');
    assert.equal(await video.getAttribute('data-play-calls'), '1', 'a new video should autoplay');

    const mute = page.getByRole('button', { name: 'Mute reel' });
    assert.equal(await mute.locator('svg').count(), 1);
    assert.equal((await mute.textContent())?.trim(), '', 'mute control should use an icon, not a text substitute');

    await video.evaluate(element => {
        (element as HTMLVideoElement).currentTime = 4.25;
        element.dispatchEvent(new Event('timeupdate'));
    });
    await page.keyboard.press('Space');
    assert.equal(await video.getAttribute('data-pause-calls'), '1', 'a Space tap should pause');
    await page.getByRole('button', { name: 'Close reel' }).click();
    await dialog.waitFor({ state: 'detached' });

    await preview.click();
    await dialog.waitFor();
    video = page.locator('.reel-stage video');
    await page.waitForTimeout(50);
    await video.dispatchEvent('loadedmetadata');
    assert.equal(await video.getAttribute('data-play-calls'), null, 'a user-paused video should not autoplay on reopen');
    assert.ok(Math.abs(await video.evaluate(element => (element as HTMLVideoElement).currentTime) - 4.25) < 0.01);

    await page.keyboard.press('Space');
    assert.equal(await video.getAttribute('data-play-calls'), '1', 'a Space tap should resume');
    await video.evaluate(element => { (element as HTMLVideoElement).playbackRate = 1.5; });
    const callsBeforeHold = await video.evaluate(element => ({
        plays: element.getAttribute('data-play-calls'),
        pauses: element.getAttribute('data-pause-calls'),
    }));
    await page.keyboard.down('Space');
    await page.waitForTimeout(275);
    assert.equal(await video.evaluate(element => (element as HTMLVideoElement).playbackRate), 2);
    await page.keyboard.up('Space');
    assert.equal(await video.evaluate(element => (element as HTMLVideoElement).playbackRate), 1.5);
    assert.deepEqual(await video.evaluate(element => ({
        plays: element.getAttribute('data-play-calls'),
        pauses: element.getAttribute('data-pause-calls'),
    })), callsBeforeHold, 'a Space hold must not also toggle playback');

    await page.keyboard.down('Space');
    await page.waitForTimeout(275);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await video.evaluate(element => (element as HTMLVideoElement).playbackRate), 1.5);
    await page.keyboard.up('Space');
    assert.deepEqual(await video.evaluate(element => ({
        plays: element.getAttribute('data-play-calls'),
        pauses: element.getAttribute('data-pause-calls'),
    })), callsBeforeHold, 'blur cleanup must not turn a hold into a tap');

    await video.evaluate(element => {
        (element as HTMLVideoElement).currentTime = 6.5;
        element.dispatchEvent(new Event('timeupdate'));
    });
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.waitForFunction(() => document.querySelector('.reel-stage')?.getAttribute('aria-label') === 'Slide 4 of 4');
    video = page.locator('.reel-stage video');
    await video.dispatchEvent('loadedmetadata');
    assert.equal(await video.getAttribute('data-play-calls'), '1', 'a distinct carousel video should autoplay independently');
    assert.ok(Math.abs(await video.evaluate(element => (element as HTMLVideoElement).currentTime)) < 0.01);
    await video.evaluate(element => {
        (element as HTMLVideoElement).currentTime = 2.75;
        element.dispatchEvent(new Event('timeupdate'));
    });

    await page.getByRole('button', { name: 'Previous slide' }).click();
    await page.getByRole('button', { name: 'Previous slide' }).click();
    await page.getByRole('button', { name: 'Previous slide' }).click();
    video = page.locator('.reel-stage video');
    await video.dispatchEvent('loadedmetadata');
    assert.ok(Math.abs(await video.evaluate(element => (element as HTMLVideoElement).currentTime) - 6.5) < 0.01);
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.getByRole('button', { name: 'Next slide' }).click();
    await page.getByRole('button', { name: 'Next slide' }).click();
    video = page.locator('.reel-stage video');
    await video.dispatchEvent('loadedmetadata');
    assert.ok(Math.abs(await video.evaluate(element => (element as HTMLVideoElement).currentTime) - 2.75) < 0.01);
    await page.close();
});

test('modal retries expired cached video and current carousel image with refreshed URLs', async () => {
    const page = await openHarness({ width: 1100, height: 760 });
    await page.evaluate(() => window.historyHarness.mount('reel'));
    await page.getByRole('button', { name: 'Open reel from reel_author' }).click();
    await page.getByRole('dialog', { name: 'Reel by Reel Author' }).waitFor();

    const video = page.locator('.reel-stage video');
    const cachedVideoUrl = await video.getAttribute('src');
    await video.dispatchEvent('error');
    const videoRetry = page.getByRole('button', { name: 'Retry reel media' });
    await videoRetry.waitFor();
    await videoRetry.evaluate(button => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
    });
    assert.equal(await video.getAttribute('src'), cachedVideoUrl, 'cached video disappeared during refresh');
    await page.waitForFunction(() => window.historyHarness.reelMetrics().reelMediaCalls === 2);
    await page.waitForFunction(() => document.querySelector('.reel-stage video')?.getAttribute('src')?.endsWith('#fresh-2'));
    assert.equal((await page.getByText('Great reel').count()) > 0, true);

    await page.keyboard.press('ArrowRight');
    const image = page.locator('.reel-stage img[alt="Reel image"]');
    await image.waitFor();
    const cachedImageUrl = await image.getAttribute('src');
    await image.dispatchEvent('error');
    const imageRetry = page.getByRole('button', { name: 'Retry reel media' });
    await imageRetry.click();
    assert.equal(await image.getAttribute('src'), cachedImageUrl, 'cached image disappeared during refresh');
    await page.waitForFunction(() => window.historyHarness.reelMetrics().reelMediaCalls === 3);
    await page.waitForFunction(() => document.querySelector('.reel-stage img')?.getAttribute('src')?.endsWith('#fresh-3'));
    assert.deepEqual(await page.evaluate(() => window.historyHarness.reelMetrics()), {
        reelCommentCalls: 2,
        reelMediaCalls: 3,
        reelLikeCalls: 0,
        reelSaveCalls: 0,
    });
    await page.close();
});

test('activity and fallback messages stay friendly, inert, escaped, and free of empty media', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('events'));
    await page.waitForFunction(() => document.querySelector('[data-message-id="future-fallback"]'));
    const result = await page.evaluate(() => {
        const activity = document.querySelector<HTMLElement>('[data-message-id="activity-message"]')!;
        const historyText = document.querySelector('.messages')?.textContent ?? '';
        return {
            activityCentered: getComputedStyle(activity.querySelector('.message')!).justifyContent,
            activityAction: Boolean(activity.querySelector('.message__reaction-rail')),
            images: document.querySelectorAll('.messages img').length,
            boldElements: document.querySelectorAll('[data-message-id="ai-fallback"] b').length,
            historyText,
            summary: document.querySelector('.chat-row__snippet')?.textContent,
        };
    });
    assert.equal(result.activityCentered, 'center');
    assert.equal(result.activityAction, false);
    assert.equal(result.images, 0);
    assert.equal(result.boldElements, 0);
    assert.match(result.historyText, /Meta AI response: <b>Safe answer<\/b>/);
    assert.match(result.historyText, /Unsupported message/);
    assert.doesNotMatch(result.historyText, /GEN_AI_RICH_RESPONSE_XMA|FUTURE_SECRET_CARD/);
    assert.equal(result.summary, 'Unsupported message');
    await page.close();
});

test('private chats reserve sender identity only for a known non-peer participant', async () => {
    const page = await openHarness({ width: 900, height: 600 });
    await page.evaluate(() => window.historyHarness.mount('identity-pm'));
    await page.waitForFunction(() => document.querySelector('[data-message-id="ai-2"]'));
    const identity = await page.evaluate(() => ({
        avatarSenders: [...document.querySelectorAll<HTMLElement>('.message-group--identity')]
            .map(group => group.dataset.senderId),
        senderNames: [...document.querySelectorAll('.message__sender-name')]
            .map(name => name.textContent),
        peerHasAvatar: Boolean(document.querySelector('.message-group[data-sender-id="peer"] .message-group__avatar')),
        viewerHasAvatar: Boolean(document.querySelector('.message-group[data-sender-id="viewer"] .message-group__avatar')),
        unknownHasAvatar: Boolean(document.querySelector('.message-group[data-sender-id="unknown"] .message-group__avatar')),
    }));
    assert.deepEqual(identity, {
        avatarSenders: ['ai'],
        senderNames: [],
        peerHasAvatar: false,
        viewerHasAvatar: false,
        unknownHasAvatar: false,
    });
    await page.close();
});

test('same-sender history prepend preserves the message run DOM wrapper', async () => {
    const page = await openHarness({ width: 900, height: 600 });
    await page.evaluate(() => window.historyHarness.mount('delayed'));
    await page.evaluate(() => {
        document.querySelector<HTMLElement>('.messages')!.scrollTop = 260;
    });
    await page.waitForFunction(() =>
        window.historyHarness.calls().includes('c1') && document.querySelector('[data-message-id="m40"]'),
    );
    await page.evaluate(() => {
        const group = document.querySelector<HTMLElement>('.message-group')!;
        (group as HTMLElement & { prependIdentity?: object }).prependIdentity = {};
    });
    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.waitForFunction(() => document.querySelector('[data-message-id="m20"]'));
    assert.equal(await page.evaluate(() => Boolean(
        (document.querySelector('.message-group') as HTMLElement & { prependIdentity?: object })
            .prependIdentity,
    )), true);
    await page.close();
});

test('older pagination preserves established viewer identity and outgoing row DOM', async () => {
    const page = await openHarness({ width: 900, height: 600 });
    await page.evaluate(() => window.historyHarness.mount('outgoing-prepend'));
    await page.evaluate(() => {
        document.querySelector<HTMLElement>('.messages')!.scrollTop = 260;
    });
    await page.waitForFunction(() =>
        window.historyHarness.calls().includes('c1') && document.querySelector('[data-message-id="m40"]'),
    );
    const row = await page.locator('[data-message-id="m40"]').elementHandle();
    const group = await page.locator('.message-group[data-sender-id="interop-viewer"]').elementHandle();
    assert.ok(row && group);
    assert.equal(await row.evaluate(element => element.querySelector('.message')?.classList.contains('message--outgoing')), true);

    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.waitForFunction(() => document.querySelector('[data-message-id="m20"]'));

    assert.equal(await row.evaluate(element => element === document.querySelector('[data-message-id="m40"]')), true);
    assert.equal(await group.evaluate(element =>
        element === document.querySelector('.message-group[data-sender-id="interop-viewer"]'),
    ), true);
    assert.equal(await row.evaluate(element => element.querySelector('.message')?.classList.contains('message--outgoing')), true);
    await page.close();
});

test('group sender names lead runs and incoming avatars stick to the visible group bottom', async () => {
    const page = await openHarness({ width: 900, height: 500 });
    await page.evaluate(() => window.historyHarness.mount('identity-group'));
    await page.waitForFunction(() => document.querySelector('[data-message-id="bob-group"]'));
    const result = await page.evaluate(async () => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const aliceGroup = document.querySelector<HTMLElement>('.message-group[data-sender-id="peer"]')!;
        scroller.scrollTop = aliceGroup.offsetTop + 120;
        scroller.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const avatar = aliceGroup.querySelector<HTMLElement>('.message-group__avatar')!;
        const firstName = document.querySelector('[data-message-id="alice-0"] .message__sender-name');
        return {
            identitySenders: [...document.querySelectorAll<HTMLElement>('.message-group--identity')]
                .map(group => group.dataset.senderId),
            names: [...document.querySelectorAll('.message__sender-name')].map(name => name.textContent),
            firstName: firstName?.textContent,
            laterAliceNames: document.querySelectorAll(
                '[data-message-id^="alice-"]:not([data-message-id="alice-0"]) .message__sender-name',
            ).length,
            viewerIdentity: Boolean(document.querySelector('.message-group[data-sender-id="viewer"].message-group--identity')),
            avatarBottom: avatar.getBoundingClientRect().bottom,
            viewportBottom: scroller.getBoundingClientRect().bottom,
            groupBottom: aliceGroup.getBoundingClientRect().bottom,
        };
    });
    assert.deepEqual(result.identitySenders, ['peer', 'bob']);
    assert.deepEqual(result.names, ['Alice', 'Bob']);
    assert.equal(result.firstName, 'Alice');
    assert.equal(result.laterAliceNames, 0);
    assert.equal(result.viewerIdentity, false);
    assert.ok(result.groupBottom > result.viewportBottom, 'test did not place the group across the viewport bottom');
    assert.ok(
        Math.abs(result.avatarBottom - (result.viewportBottom - 4)) < 1,
        `avatar bottom ${result.avatarBottom}, viewport bottom ${result.viewportBottom}`,
    );
    await page.close();
});

test('intermediate shell keeps the resizable default and a usable conversation without overflow', async () => {
    const page = await openHarness({ width: 800, height: 650 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.conversation__header'));
    const result = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const conversation = document.querySelector<HTMLElement>('.conversation')!;
        return {
            sidebarWidth: sidebar.getBoundingClientRect().width,
            conversationWidth: conversation.getBoundingClientRect().width,
            resize: getComputedStyle(sidebar).resize,
            handleDisplay: getComputedStyle(document.querySelector<HTMLElement>('.sidebar-resize')!).display,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    assert.equal(result.sidebarWidth, 390);
    assert.ok(result.conversationWidth >= 320);
    assert.equal(result.resize, 'none');
    assert.notEqual(result.handleDisplay, 'none');
    assert.ok(result.overflow <= 0);
    await page.close();
});

test('compact shell shows one pane and the rounded back control returns to inbox', async () => {
    const page = await openHarness({ width: 390, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.conversation__header'));
    const beforeIds = await page.evaluate(() => window.historyHarness.historyState('thread').viewportIds);
    const selectedLayout = await page.evaluate(() => {
        const back = document.querySelector<HTMLElement>('.conversation__back')!;
        return {
            sidebar: getComputedStyle(document.querySelector('.sidebar')!).display,
            conversation: getComputedStyle(document.querySelector('.conversation')!).display,
            backDisplay: getComputedStyle(back).display,
            backRadius: getComputedStyle(back).borderRadius,
            backLabel: back.getAttribute('aria-label'),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    assert.equal(selectedLayout.sidebar, 'none');
    assert.equal(selectedLayout.conversation, 'flex');
    assert.equal(selectedLayout.backDisplay, 'grid');
    assert.equal(selectedLayout.backRadius, '50%');
    assert.equal(selectedLayout.backLabel, 'Back to inbox');
    assert.ok(selectedLayout.overflow <= 0);

    const beforeAnchor = await page.evaluate(async () => {
        const messages = document.querySelector<HTMLElement>('.messages')!;
        messages.scrollTop = 240;
        messages.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => requestAnimationFrame(resolve));
        return window.historyHarness.historyState('thread').scrollAnchor;
    });
    assert.ok(beforeAnchor);

    await page.getByRole('button', { name: 'Back to inbox' }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.sidebar')!).display !== 'none');
    assert.deepEqual(await page.evaluate(() => ({
        selected: window.historyHarness.historyState('thread').selected,
        sidebar: getComputedStyle(document.querySelector('.sidebar')!).display,
        conversation: getComputedStyle(document.querySelector('.conversation')!).display,
    })), { selected: undefined, sidebar: 'flex', conversation: 'none' });

    const chat = page.getByRole('button', { name: 'History harness', exact: true });
    const chatBox = await chat.boundingBox();
    assert.ok(chatBox);
    await chat.dispatchEvent('pointerdown', {
        pointerType: 'touch', pointerId: 4, isPrimary: true,
        clientX: chatBox!.x + 12, clientY: chatBox!.y + 12,
    });
    await page.waitForTimeout(550);
    await chat.dispatchEvent('pointerup', {
        pointerType: 'touch', pointerId: 4, isPrimary: true,
        clientX: chatBox!.x + 12, clientY: chatBox!.y + 12,
    });
    const chatMenu = page.getByRole('menu', { name: 'Actions for History harness' });
    await chatMenu.waitFor();
    await chat.dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), undefined);
    await page.keyboard.press('Escape');
    await chatMenu.waitFor({ state: 'detached' });
    await chat.click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.conversation')!).display === 'flex');
    assert.deepEqual(
        await page.evaluate(() => window.historyHarness.historyState('thread').viewportIds),
        beforeIds,
    );
    const restored = await page.evaluate(anchor => {
        const messages = document.querySelector<HTMLElement>('.messages')!;
        const row = document.querySelector<HTMLElement>(`[data-message-id="${anchor!.id}"]`)!;
        return {
            anchor: window.historyHarness.historyState('thread').scrollAnchor,
            offset: row.getBoundingClientRect().top - messages.getBoundingClientRect().top,
        };
    }, beforeAnchor);
    assert.deepEqual(restored.anchor, beforeAnchor);
    assert.ok(Math.abs(restored.offset - beforeAnchor!.offset) < 1);
    await page.close();
});

test('short viewport keeps messages scrolling beneath the overlaid header', async () => {
    const page = await openHarness({ width: 900, height: 360 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('[data-message-id]'));
    const result = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const header = document.querySelector<HTMLElement>('.conversation__header')!;
        const messages = document.querySelector<HTMLElement>('.messages')!;
        const rect = messages.getBoundingClientRect();
        return {
            shellPadding: getComputedStyle(document.querySelector('.app-shell')!).padding,
            sidebarRadius: getComputedStyle(sidebar).borderRadius,
            sidebarShadow: getComputedStyle(sidebar).boxShadow,
            headerBottom: header.getBoundingClientRect().bottom,
            messageTop: rect.top,
            messageBottom: rect.bottom,
            messageHeight: rect.height,
            scrollable: messages.scrollHeight > messages.clientHeight,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    assert.equal(result.shellPadding, '0px');
    assert.equal(result.sidebarRadius, '0px');
    assert.equal(result.sidebarShadow, 'none');
    assert.ok(result.messageTop < result.headerBottom && result.messageBottom <= 360);
    assert.ok(result.messageHeight > 100);
    assert.equal(result.scrollable, true);
    assert.ok(result.overflow <= 0);
    await page.close();
});

test('hovered shared posts remain beneath the conversation header', async () => {
    const page = await openHarness({ width: 900, height: 360 });
    await page.evaluate(() => window.historyHarness.mount('keyboard-actions'));
    const post = page.locator('[data-message-id="keyboard-post"]');
    await post.waitFor();
    await post.evaluate(row => {
        const messages = document.querySelector<HTMLElement>('.messages')!;
        messages.scrollTop = (row as HTMLElement).offsetTop;
    });
    await post.hover();

    const result = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>('.conversation__header')!;
        const postRow = document.querySelector<HTMLElement>('[data-message-id="keyboard-post"]')!;
        const headerRect = header.getBoundingClientRect();
        const postRect = postRow.getBoundingClientRect();
        const x = Math.max(headerRect.left, postRect.left) + 8;
        const y = Math.max(headerRect.top, postRect.top) + 8;
        return {
            overlaps: x < Math.min(headerRect.right, postRect.right) &&
                y < Math.min(headerRect.bottom, postRect.bottom),
            headerOwnsOverlap: document.elementFromPoint(x, y)?.closest('.conversation__header') === header,
        };
    });

    assert.equal(result.overlaps, true);
    assert.equal(result.headerOwnsOverlap, true);
    await page.close();
});

test('real pane drains a continuously intersecting sentinel with one request and preload', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('continuous'));
    await page.waitForFunction(() =>
        window.historyHarness.calls().filter(cursor => cursor === 'c1').length === 1 &&
        window.historyHarness.calls().filter(cursor => cursor === 'c2').length === 1 &&
        document.querySelector('[data-message-id="m0"]'),
    );
    await page.waitForTimeout(1_100);
    const result = await page.evaluate(() => ({
        calls: window.historyHarness.calls(),
        rows: document.querySelectorAll('[data-message-id]').length,
        first: document.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId,
        beginningBeforeRows: Boolean(
            document.querySelector('.messages__content > .messages__beginning + .messages__rows'),
        ),
    }));
    assert.deepEqual(result.calls, [undefined, 'c1', 'c2']);
    assert.equal(result.rows <= 80, true);
    assert.equal(result.first, 'm0');
    assert.equal(result.beginningBeforeRows, true);
    await page.close();
});

test('delayed RPC captures the user current anchor immediately before the real commit', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('delayed'));
    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = 260;
    });
    await page.waitForFunction(() => window.historyHarness.calls().includes('c1'));
    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop += 360;
        const rows = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')];
        const visible = rows.filter(row => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
        const anchor = visible[1] ?? visible[0];
        return { id: anchor.dataset.messageId!, top: anchor.getBoundingClientRect().top };
    });
    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.waitForFunction(() => document.querySelector('[data-message-id="m20"]'));
    const after = await page.locator(`[data-message-id="${before.id}"]`).evaluate(row =>
        row.getBoundingClientRect().top,
    );
    assert.ok(Math.abs(after - before.top) < 1, `anchor drift was ${Math.abs(after - before.top)}px`);
    await page.close();
});

test('selecting another thread before commit cannot reveal the old viewport', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('selection'));
    await page.evaluate(() => {
        document.querySelector<HTMLElement>('.messages')!.scrollTop = 260;
    });
    await page.waitForFunction(() => window.historyHarness.calls().includes('c1'));
    const beforeViewportIds = await page.evaluate(() =>
        window.historyHarness.historyState('thread').viewportIds,
    );
    await page.evaluate(() => {
        window.historyHarness.select('second-thread');
        window.historyHarness.resolveVisible();
    });
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history',
    );
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => window.historyHarness.historyState('thread'));
    assert.equal(state.selected, 'second-thread');
    assert.deepEqual(state.viewportIds, beforeViewportIds);
    assert.equal(state.isReplacingViewport, false);
    await page.close();
});

test('real pane ResizeObserver corrects growth above the active anchor', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.evaluate(async () => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = 420;
        scroller.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const rows = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')];
        const visible = rows.filter(row => row.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top);
        const anchor = visible[1] ?? visible[0];
        return {
            id: anchor.dataset.messageId!,
            top: anchor.getBoundingClientRect().top,
            scrollTop: scroller.scrollTop,
        };
    });
    await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-message-id]')];
        rows[0].style.height = `${rows[0].getBoundingClientRect().height + 140}px`;
    });
    await page.waitForTimeout(100);
    const after = await page.evaluate(id => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const row = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
        return { top: row.getBoundingClientRect().top, scrollTop: scroller.scrollTop };
    }, before.id);
    const correction = after.scrollTop - before.scrollTop;
    const drift = Math.abs(after.top - before.top);
    assert.ok(Math.abs(correction - 140) < 1, `resize correction was ${correction}px`);
    assert.ok(drift < 1, `resize anchor drift was ${drift}px`);
    await page.close();
});

test('composer keyboard behavior sends without remounting the reconciled production row', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('mutations'));
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('first line');
    await composer.press('Shift+Enter');
    assert.equal(await composer.inputValue(), 'first line\n');
    assert.equal(await page.locator('[data-message-id^="local:"]').count(), 0);

    await composer.fill('deferred');
    await composer.press('Enter');
    const pending = page.locator('[data-message-id^="local:"]');
    await pending.waitFor();
    await page.locator('.message__delivery').filter({ hasText: 'Sending…' }).waitFor();
    const pendingNode = await pending.elementHandle();
    assert.ok(pendingNode);

    await page.evaluate(() => window.historyHarness.resolveSend());
    await page.locator('[data-message-id="server-deferred"]').waitFor();
    assert.equal(await pendingNode.evaluate(node =>
        node === document.querySelector('[data-message-id="server-deferred"]'),
    ), true, 'optimistic-to-server reconciliation remounted the message row');
    assert.equal(await composer.inputValue(), '');
    await page.close();
});

test('reply selection, failed-send recovery, and bounded reaction picker are accessible', async () => {
    const page = await openHarness({ width: 900, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('mutations'));

    assert.equal(await page.getByRole('button', { name: 'Message actions' }).count(), 0);
    assert.equal(await page.locator('.chat-row__menu-trigger').count(), 0);
    assert.equal(await page.getByText('•••', { exact: true }).count(), 0);
    const reactionRail = page.locator('[data-message-id="m0"] .message__reaction-rail');
    const reactionAffordance = page.locator('[data-message-id="m0"] .message__reaction-expander');
    assert.equal(await reactionRail.evaluate(element => getComputedStyle(element).opacity), '0');
    await page.locator('[data-message-id="m0"] .message__bubble').hover();
    await page.waitForFunction(() => getComputedStyle(
        document.querySelector('[data-message-id="m0"] .message__reaction-rail')!,
    ).opacity === '1');
    assert.equal(await reactionRail.locator('button:visible').count(), 1);
    await page.locator('[data-message-id="m0"] .message__reaction-default').hover();
    assert.equal(await reactionRail.locator('button:visible').count(), 7);
    const incomingAlignment = await page.locator('[data-message-id="m0"]').evaluate(element => {
        const bubble = element.querySelector('.message__bubble')!.getBoundingClientRect();
        const rail = element.querySelector('.message__reaction-rail')!;
        const trigger = rail.getBoundingClientRect();
        return {
            bubbleRight: bubble.right,
            triggerLeft: trigger.left,
            railWidth: trigger.width,
            railHeight: trigger.height,
            buttonColumns: new Set([...rail.querySelectorAll('button')].map(button =>
                Math.round(button.getBoundingClientRect().left))).size,
        };
    });
    assert.ok(incomingAlignment.triggerLeft >= incomingAlignment.bubbleRight);
    assert.equal(incomingAlignment.buttonColumns, 7);
    assert.ok(incomingAlignment.railWidth > incomingAlignment.railHeight);
    await reactionAffordance.click();
    await page.getByRole('menu', { name: 'Choose a reaction' }).waitFor();
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await page.locator('[data-message-id="m0"]').focus();
    assert.equal(await reactionRail.evaluate(element => getComputedStyle(element).opacity), '1');
    assert.equal(await reactionRail.locator('button:visible').count(), 1);
    await page.keyboard.press('Tab');
    assert.equal(await reactionRail.locator('button:visible').count(), 7);

    await page.locator('[data-message-id="m0"]').click({ button: 'right' });
    const replyAnchorTop = await page.locator('[data-message-id="m0"]').evaluate(element => element.getBoundingClientRect().top);
    await page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Reply' }).click();
    await page.getByText('Replying to').waitFor();
    assert.ok(await page.locator('.composer__reply .message__reply').textContent());
    assert.equal((await page.evaluate(() => window.historyHarness.historyState('thread'))).replyTargetId, 'm0');
    assert.equal(await page.getByRole('textbox', { name: 'Message' }).evaluate(element => element === document.activeElement), true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.ok(Math.abs(await page.locator('[data-message-id="m0"]').evaluate(
        element => element.getBoundingClientRect().top,
    ) - replyAnchorTop) < 1);
    await page.getByRole('button', { name: 'Cancel reply' }).click();
    assert.equal((await page.evaluate(() => window.historyHarness.historyState('thread'))).replyTargetId, undefined);

    await reactionAffordance.evaluate(element => (element as HTMLElement).click());
    const picker = page.getByRole('menu', { name: 'Choose a reaction' });
    await picker.waitFor();
    assert.equal(await picker.getByRole('menuitemradio').count(), 18);
    assert.deepEqual(await picker.getByRole('group').allTextContents(), [
        'Faces😂😮😢😡🥰😱',
        'Gestures👍👏🙌🙏💪👎',
        'Symbols❤🔥✨🎉💯💔',
    ]);
    await picker.getByRole('menuitemradio', { name: 'React with 😂' }).press('Enter');
    await page.locator('.reaction-chip--viewer').first().waitFor();
    assert.match(
        await page.locator('.reaction-chip--viewer').first().getAttribute('aria-label') ?? '',
        /Remove your/,
    );
    await reactionAffordance.evaluate(element => (element as HTMLElement).click());
    const currentReaction = page.getByRole('menuitemradio', { name: 'Remove reaction 😂' });
    await currentReaction.waitFor();
    assert.equal(await currentReaction.getAttribute('aria-checked'), 'true');
    assert.equal(await currentReaction.isDisabled(), false);
    const earlierReaction = page.getByRole('menuitemradio', { name: 'React with 😮' });
    const laterReaction = page.getByRole('menuitemradio', { name: 'React with 😢' });
    await earlierReaction.press('ArrowRight');
    assert.equal(await laterReaction.evaluate(element => element === document.activeElement), true);
    await laterReaction.press('ArrowLeft');
    assert.equal(await earlierReaction.evaluate(element => element === document.activeElement), true);
    await earlierReaction.press('ArrowDown');
    assert.equal(await page.getByRole('menuitemradio', { name: 'React with 👏' }).evaluate(
        element => element === document.activeElement,
    ), true);
    await page.keyboard.press('ArrowUp');
    assert.equal(await earlierReaction.evaluate(element => element === document.activeElement), true);
    await earlierReaction.press('End');
    assert.equal(await page.getByRole('menuitemradio', { name: 'React with 💔' }).evaluate(
        element => element === document.activeElement,
    ), true);
    await page.getByRole('menuitemradio', { name: 'React with 👍' }).press('Home');
    assert.equal(await currentReaction.evaluate(element => element === document.activeElement), true);
    await currentReaction.press('ArrowRight');
    assert.equal(await earlierReaction.evaluate(element => element === document.activeElement), true);
    await earlierReaction.press('ArrowRight');
    await laterReaction.press('Enter');
    await page.waitForFunction(() => document.querySelector('.reaction-chip--viewer')?.textContent?.includes('😢'));
    const callsBeforeQuickReaction = (await page.evaluate(() => window.historyHarness.reactionCalls())).length;
    await page.locator('[data-message-id="m0"] .message__bubble').hover();
    await page.locator('[data-message-id="m0"] .message__reaction-default').hover();
    await page.locator('[data-message-id="m0"]').getByRole('button', { name: 'React with 👍' }).click();
    await page.waitForFunction(() => document.querySelector(
        '[data-message-id="m0"] .reaction-chip--viewer',
    )?.textContent?.includes('👍'));
    assert.equal(
        (await page.evaluate(() => window.historyHarness.reactionCalls())).length,
        callsBeforeQuickReaction + 1,
    );
    const placedReaction = page.locator('[data-message-id="m0"] .reaction-chip--viewer');
    await placedReaction.click();
    await page.waitForFunction(() => !document.querySelector('[data-message-id="m0"] .reaction-chip--viewer'));
    assert.deepEqual((await page.evaluate(() => window.historyHarness.reactionCalls())).at(-1), {
        threadFbid: '1001', messageId: 'm0', emoji: '👍', remove: true,
    });

    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
    });
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('fail once');
    assert.equal(await composer.inputValue(), 'fail once');
    await composer.press('Enter');
    await page.locator('.message__delivery').filter({ hasText: 'Sending…' }).waitFor();
    const failure = page.locator('.message__failure').filter({ hasText: 'Not sent' });
    await failure.waitFor();
    assert.equal(await failure.getByRole('button', { name: 'Retry' }).count(), 1);
    assert.equal(await failure.getByRole('button', { name: 'Remove' }).count(), 1);
    await page.locator('[data-message-id^="local:"]').last().click({ button: 'right' });
    const failedMenu = page.getByRole('menu', { name: 'Message actions' });
    await failedMenu.waitFor();
    assert.equal(await failedMenu.getByRole('menuitem', { name: 'Retry send' }).count(), 1);
    assert.equal(await failedMenu.getByRole('menuitem', { name: 'Remove failed message' }).count(), 1);
    await failedMenu.getByRole('menuitem', { name: 'Retry send' }).click();
    await page.locator('[data-message-id="server-1"]').waitFor();
    assert.equal(await failure.count(), 0);
    await page.close();
});

test('reply preview loads through older history and focuses the original in a bounded window', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('reply-navigation'));
    const reply = page.locator('[data-message-id="m119"]')
        .getByRole('button', { name: 'Go to original message: Original message 10' });
    await reply.waitFor();
    await reply.click();
    const target = page.locator('[data-message-id="m10"]');
    await target.waitFor();
    await page.getByRole('status').filter({ hasText: 'Original message loaded' }).waitFor();

    const result = await target.evaluate(row => {
        const scroller = row.closest<HTMLElement>('.messages')!;
        const rowRect = row.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return {
            active: document.activeElement === row,
            rowCenter: rowRect.top + rowRect.height / 2,
            scrollerCenter: scrollerRect.top + scrollerRect.height / 2,
            renderedRows: scroller.querySelectorAll('[data-message-id]').length,
        };
    });
    assert.equal(result.active, true);
    assert.ok(Math.abs(result.rowCenter - result.scrollerCenter) < 2);
    assert.ok(result.renderedRows <= 80);
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1', 'c2', 'c3', 'c4']);
    await page.close();
});

test('reply preview supports keyboard activation and rerenders an explicit retry error', async () => {
    let page = await openHarness({ width: 900, height: 520 });
    const replyName = 'Go to original message: Original message 10';

    await page.evaluate(() => window.historyHarness.mount('reply-navigation'));
    await page.getByRole('button', { name: replyName }).press('Enter');
    await page.locator('[data-message-id="m10"]').waitFor();

    await page.evaluate(() => window.historyHarness.mount('reply-navigation'));
    await page.getByRole('button', { name: replyName }).press('Space');
    await page.locator('[data-message-id="m10"]').waitFor();

    // Isolate the retry contract from reply/viewport prefetch work started by
    // the keyboard-activation mounts above. Prefetch reuse has dedicated
    // coverage below; this scenario must leave c1 for the user click to fail.
    await page.close();
    page = await openHarness({ width: 900, height: 520 });

    await page.evaluate(() => {
        Object.defineProperty(window, 'IntersectionObserver', {
            configurable: true,
            value: class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        });
        return window.historyHarness.mount('reply-navigation-retry');
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => window.historyHarness.showReplyPreview());
    await page.getByRole('button', { name: replyName }).press('Enter');
    const failure = page.getByRole('alert').filter({ hasText: 'Harness reply failure' });
    await failure.waitFor();
    assert.equal(await page.locator('[data-message-id="m119"]').count(), 1);
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1']);
    await failure.getByRole('button', { name: 'Retry' }).press('Space');
    await page.locator('[data-message-id="m10"]').waitFor();
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1', 'c1', 'c2', 'c3', 'c4']);
    await page.close();
});

test('visible reply prefetch is reused while click progress and icon return stay accessible', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('reply-navigation-delayed'));
    const reply = page.getByRole('button', {
        name: 'Go to original message: Original message 10',
    });
    await reply.waitFor();
    await page.waitForFunction(() => window.historyHarness.calls().length === 2);
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1']);

    await reply.click();
    await page.getByRole('status').filter({
        hasText: 'Loading original message… Searching older history.',
    }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1']);
    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.locator('[data-message-id="m10"]').waitFor();

    const returnButton = page.getByRole('button', {
        name: 'Return to previous reply message (1 step remaining)',
    });
    await returnButton.waitFor();
    assert.equal((await returnButton.textContent())?.trim(), '');
    assert.equal(await returnButton.locator('svg').count(), 1);
    await returnButton.click();
    await page.waitForFunction(() =>
        window.historyHarness.historyState('thread').replyNavigation?.targetId === 'm119');
    const returned = page.locator('[data-message-id="m119"]');
    await returned.waitFor();
    await page.waitForFunction(() =>
        window.historyHarness.historyState('thread').replyReturnStack?.length === 0);
    assert.deepEqual(
        (await page.evaluate(() => window.historyHarness.historyState('thread'))).replyReturnStack,
        [],
    );
    await page.close();
});

test('reply geometry prefetch paints onscreen click progress and resumes after focus', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => {
        Object.defineProperty(window, 'IntersectionObserver', {
            configurable: true,
            value: class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        });
        return window.historyHarness.mount('reply-navigation-prefetch-resume');
    });
    const reply = page.getByRole('button', {
        name: 'Go to original message: Original message 65',
    });
    await reply.waitFor();

    // The scenario moves the ordinary sentinel out of range and this observer
    // never calls back, so c1 can only originate in the immediate reply scan.
    await page.waitForFunction(() => window.historyHarness.calls().includes('c1'));
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1']);
    await reply.click();

    const pending = page.getByRole('status').filter({ hasText: 'Loading original message' });
    await pending.waitFor();
    assert.equal(await pending.evaluate(element => {
        const status = element.getBoundingClientRect();
        const viewport = document.querySelector<HTMLElement>('.messages')!.getBoundingClientRect();
        return status.width > 0 && status.height > 0 &&
            status.right > viewport.left && status.left < viewport.right &&
            status.bottom > viewport.top && status.top < viewport.bottom;
    }), true);
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1']);

    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-message-id') === 'm65');
    await page.waitForFunction(() => window.historyHarness.calls().includes('c2'));
    assert.ok(await page.locator('[data-message-id]').count() <= 80);
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), [undefined, 'c1', 'c2']);
    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.close();
});

test('delayed reply navigation cannot alter the old pane after returning to inbox', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('reply-navigation-delayed'));
    const reply = page.getByRole('button', {
        name: 'Go to original message: Original message 10',
    });
    await reply.waitFor();
    await page.waitForFunction(() => window.historyHarness.calls().includes('c1'));
    const before = (await page.evaluate(() =>
        window.historyHarness.historyState('thread'))).viewportIds;
    await reply.click();
    await page.getByRole('status').filter({ hasText: 'Loading original message' }).waitFor();
    await page.evaluate(() => window.historyHarness.showInbox());
    await page.getByRole('button', { name: 'History harness', exact: true }).waitFor();
    await page.evaluate(() => window.historyHarness.resolveVisible());
    await page.waitForTimeout(100);
    const old = await page.evaluate(() => window.historyHarness.historyState('thread'));
    assert.deepEqual(old.viewportIds, before);
    assert.equal(old.replyNavigation, undefined);
    assert.deepEqual(old.replyReturnStack, []);
    assert.equal(await page.locator('[data-message-id="m10"]').count(), 0);
    assert.equal(await page.locator('.conversation__header h2').count(), 0);
    await page.close();
});

test('reply chain near latest keeps down navigation until newest window reaches DOM bottom', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('reply-navigation-chain'));

    await page.locator('[data-message-id="m105"]')
        .getByRole('button', { name: 'Go to original message: Message B' }).click();
    await page.locator('[data-message-id="m95"]')
        .getByRole('button', { name: 'Go to original message: Message A' }).click();
    await page.getByRole('button', {
        name: 'Return to previous reply message (2 steps remaining)',
    }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-message-id') === 'm95');
    await page.getByRole('button', {
        name: 'Return to previous reply message (1 step remaining)',
    }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-message-id') === 'm105');

    const newest = page.getByRole('button', { name: 'Go to newest message' });
    await newest.waitFor();
    assert.equal(await page.locator('[data-message-id="m119"]').count(), 1);
    await newest.click();
    await newest.waitFor({ state: 'detached' });
    const distance = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    });
    assert.ok(distance <= 2, `reply-chain newest navigation ended ${distance}px from bottom`);
    await page.close();
});

test('context menus dismiss, restore focus, stay in the viewport, and close on thread switch', async () => {
    const page = await openHarness({ width: 760, height: 500 });
    await page.evaluate(() => window.historyHarness.mount('thread-state'));

    const firstMessage = page.locator('[data-message-id="m80"]');
    await firstMessage.click({ button: 'right', position: { x: 2, y: 2 } });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    await menu.waitFor();
    const rect = await menu.boundingBox();
    assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 760 && rect.y + rect.height <= 500);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    await page.waitForFunction(() => (document.activeElement as HTMLElement)?.dataset.messageId === 'm80');

    await firstMessage.focus();
    await firstMessage.press('Shift+F10');
    await menu.waitFor();
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });

    await firstMessage.click({ button: 'right' });
    await page.locator('.conversation__header').click();
    await menu.waitFor({ state: 'detached' });

    await firstMessage.click({ button: 'right' });
    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() => document.querySelector('.conversation__header h2')?.textContent === 'Second history');
    assert.equal(await menu.count(), 0);

    await page.evaluate(() => window.historyHarness.showInbox());
    const secondChat = page.getByRole('button', { name: 'Second history', exact: true });
    assert.equal(await page.getByRole('button', { name: 'Actions for Second history' }).count(), 0);
    await secondChat.click({ button: 'right' });
    const chatMenu = page.getByRole('menu', { name: 'Actions for Second history' });
    await chatMenu.waitFor();
    await page.keyboard.press('Escape');
    await chatMenu.waitFor({ state: 'detached' });
    await secondChat.focus();
    await secondChat.press('Shift+F10');
    await chatMenu.waitFor();
    assert.equal(await chatMenu.getByRole('menuitem').count(), 1);
    assert.equal(await chatMenu.getByRole('menuitem').isDisabled(), false);
    await chatMenu.getByRole('menuitem', { name: 'Pin conversation' }).click();
    await page.getByRole('alert').filter({ hasText: 'Harness pin failure' }).waitFor();
    await secondChat.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin conversation' }).click();
    await page.getByRole('button', { name: 'Second history, pinned', exact: true }).waitFor();
    await page.waitForFunction(() =>
        (document.activeElement as HTMLElement)?.dataset.threadId === 'second-thread');
    await page.getByRole('button', { name: 'Second history, pinned', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.conversation__header h2')?.textContent === 'Second history');
    await page.close();
});

test('Vim keys navigate chats and bounded history, preserve thread focus, and respect editors and menus', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    const selectedChat = page.locator('[data-thread-id="thread"]');
    await selectedChat.focus();

    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.historyHarness.historyState('thread').selected === 'second-thread');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'second-thread');
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'second-thread');
    await page.keyboard.press('k');
    await page.waitForFunction(() => window.historyHarness.historyState('thread').selected === 'thread');

    await page.keyboard.press('l');
    await page.waitForFunction(() =>
        (document.activeElement as HTMLElement)?.dataset.messageId === 'm119');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm119');
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm119');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm118');
    await page.keyboard.press('h');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'thread');
    await page.keyboard.press('j');
    await page.waitForFunction(() => window.historyHarness.historyState('thread').selected === 'second-thread');
    await page.keyboard.press('l');
    await page.waitForFunction(() =>
        (document.activeElement as HTMLElement)?.dataset.messageId === 'm119');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm119');
    await page.keyboard.press('h');
    await page.keyboard.press('k');
    await page.waitForFunction(() => window.historyHarness.historyState('thread').selected === 'thread');
    await page.keyboard.press('l');
    await page.waitForFunction(() =>
        (document.activeElement as HTMLElement)?.dataset.messageId === 'm118');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm118');

    await page.locator('[data-message-id="m80"]').focus();
    const callsBeforeBoundary = await page.evaluate(() => window.historyHarness.calls().length);
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm80');
    assert.equal(await page.evaluate(() => window.historyHarness.calls().length), callsBeforeBoundary);

    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.focus();
    await page.keyboard.press('j');
    assert.equal(await composer.inputValue(), 'j');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');

    await selectedChat.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions for History harness' });
    await menu.waitFor();
    await page.keyboard.press('j');
    assert.equal(await menu.count(), 1);
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');
    await page.keyboard.press('Escape');
    await page.close();
});

test('focused message Enter opens only an existing share action and Space leaves one default reaction', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('keyboard-actions'));
    const initialViewport = await page.evaluate(() =>
        window.historyHarness.historyState('thread').viewportIds);

    const text = page.locator('[data-message-id="keyboard-text"]');
    await text.focus();
    await page.evaluate(() => {
        (window as typeof window & { shareActivations?: string[] }).shareActivations = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText(value: string) {
                    document.documentElement.dataset.copiedPostUrl = value;
                    return Promise.resolve();
                },
            },
        });
        const link = document.querySelector<HTMLAnchorElement>('[data-message-id="keyboard-post"] a');
        if (link) link.onclick = event => {
            event.preventDefault();
            (window as typeof window & { shareActivations: string[] }).shareActivations.push(link.href);
        };
    });
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'keyboard-post');
    await page.keyboard.press('Enter');
    assert.deepEqual(
        await page.evaluate(() => (window as typeof window & { shareActivations: string[] }).shareActivations),
        ['https://www.instagram.com/p/existing-post/'],
    );
    const post = page.locator('[data-message-id="keyboard-post"]');
    await post.click({ button: 'right' });
    const postMenu = page.getByRole('menu', { name: 'Message actions' });
    await postMenu.waitFor();
    assert.deepEqual(await postMenu.getByRole('menuitem').allTextContents(), ['Reply', 'Copy post URL']);
    await postMenu.getByRole('menuitem', { name: 'Copy post URL' }).click();
    await postMenu.waitFor({ state: 'detached' });
    assert.equal(
        await page.locator('html').getAttribute('data-copied-post-url'),
        'https://www.instagram.com/p/existing-post/',
    );
    await text.focus();
    assert.equal(await text.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
    }))), true);
    assert.equal(await page.evaluate(() =>
        (window as typeof window & { shareActivations: string[] }).shareActivations.length), 1);

    const target = page.locator('[data-message-id="keyboard-target"]');
    await target.focus();
    const firstSpaceAllowed = await target.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    })));
    assert.equal(firstSpaceAllowed, false, 'a handled Space must prevent page scrolling');
    assert.deepEqual(await page.evaluate(() => window.historyHarness.reactionCalls()), [{
        threadFbid: '1001', messageId: 'keyboard-target', emoji: '❤', remove: false,
    }]);
    assert.equal(await target.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true, 'a pending duplicate is not handled');
    assert.equal((await page.evaluate(() => window.historyHarness.reactionCalls())).length, 1);
    await page.evaluate(() => window.historyHarness.resolveReaction());
    await page.waitForFunction(() => document.querySelector(
        '[data-message-id="keyboard-target"] .reaction-chip--viewer',
    )?.textContent?.includes('❤'));
    assert.equal(await target.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true, 'the already-current default is a safe unhandled no-op');
    assert.equal((await page.evaluate(() => window.historyHarness.reactionCalls())).length, 1);

    const already = page.locator('[data-message-id="keyboard-already"]');
    assert.equal(await already.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true);
    assert.equal((await page.evaluate(() => window.historyHarness.reactionCalls())).length, 1);

    const failure = page.locator('[data-message-id="keyboard-failure"]');
    await failure.focus();
    await page.keyboard.press('Space');
    await failure.getByRole('alert').filter({ hasText: 'Harness reaction failure' }).waitFor();
    assert.equal(await failure.locator('.reaction-chip--viewer').count(), 0, 'failed optimism must roll back');

    const callsBeforeSuppression = (await page.evaluate(() => window.historyHarness.reactionCalls())).length;
    assert.equal(await failure.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true,
    }))), true);
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.focus();
    await page.keyboard.press('Space');
    assert.equal(await composer.inputValue(), ' ');
    assert.equal(await failure.evaluate(row => {
        const editor = document.createElement('span');
        editor.contentEditable = 'true';
        row.append(editor);
        return editor.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ', code: 'Space', bubbles: true, cancelable: true,
        }));
    }), true);
    assert.deepEqual(await failure.evaluate(row => ['input', 'textarea', 'select'].map(tag => {
        const control = document.createElement(tag);
        row.append(control);
        return control.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ', code: 'Space', bubbles: true, cancelable: true,
        }));
    })), [true, true, true]);

    await failure.focus();
    await failure.press('Shift+F10');
    await page.getByRole('menu', { name: 'Message actions' }).waitFor();
    assert.equal(await failure.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true);
    await page.keyboard.press('Escape');
    assert.equal(await failure.evaluate(row => {
        const overlay = document.createElement('div');
        overlay.role = 'dialog';
        document.body.append(overlay);
        const allowed = row.dispatchEvent(new KeyboardEvent('keydown', {
            key: ' ', code: 'Space', bubbles: true, cancelable: true,
        }));
        overlay.remove();
        return allowed;
    }), true);

    const postLink = page.locator('[data-message-id="keyboard-post"] a');
    await postLink.evaluate(link => {
        (link as HTMLAnchorElement).onclick = event => {
            event.preventDefault();
            (window as typeof window & { shareActivations: string[] }).shareActivations.push(
                (link as HTMLAnchorElement).href,
            );
        };
    });
    await postLink.focus();
    await postLink.press('Enter');
    assert.equal(await page.evaluate(() =>
        (window as typeof window & { shareActivations: string[] }).shareActivations.length), 2,
    'native nested activation must not be duplicated by the row');
    await failure.getByRole('button', { name: 'React with ❤' }).focus();
    const reactionTrigger = failure.getByRole('button', { name: 'More reactions' });
    await reactionTrigger.evaluate(button => (button as HTMLButtonElement).click());
    await page.getByRole('menu', { name: 'Choose a reaction' }).waitFor();
    assert.equal(await failure.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() => document.querySelector('.conversation__header h2')?.textContent === 'Second history');
    await page.evaluate(() => window.historyHarness.select('thread'));
    await page.waitForFunction(() => document.querySelector('.conversation__header h2')?.textContent === 'History harness');
    const switchedAlready = page.locator('[data-message-id="keyboard-already"]');
    await switchedAlready.focus();
    assert.equal(await switchedAlready.evaluate(row => row.dispatchEvent(new KeyboardEvent('keydown', {
        key: ' ', code: 'Space', bubbles: true, cancelable: true,
    }))), true, 'the shortcut must use the switched thread normalized state');

    assert.equal((await page.evaluate(() => window.historyHarness.reactionCalls())).length, callsBeforeSuppression);
    const finalState = await page.evaluate(() => ({
        calls: window.historyHarness.calls(),
        viewportIds: window.historyHarness.historyState('thread').viewportIds,
    }));
    assert.equal(finalState.calls.some(cursor => cursor !== undefined), false,
        'keyboard actions must not paginate history');
    assert.deepEqual(finalState.viewportIds, initialViewport,
        'keyboard actions must not replace the bounded window');
    await page.close();
});

test('Vim selection minimally reveals virtual chats and rendered messages without paginating', async () => {
    const page = await openHarness({ width: 900, height: 420 });
    await page.evaluate(() => window.historyHarness.mount('vim-scroll'));
    await page.evaluate(() => window.historyHarness.showInbox());

    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');
    for (let index = 0; index < 49; index++) await page.keyboard.press('j');
    await page.waitForFunction(() =>
        (document.activeElement as HTMLElement)?.dataset.threadId === 'vim-thread-49');
    const chatScroll = await page.locator('.chat-list').evaluate(scroller => ({
        scrollTop: scroller.scrollTop,
        rect: scroller.getBoundingClientRect(),
        row: document.activeElement!.getBoundingClientRect(),
    }));
    assert.ok(chatScroll.scrollTop > 0);
    assert.ok(chatScroll.row.top >= chatScroll.rect.top && chatScroll.row.bottom <= chatScroll.rect.bottom + 1);
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'vim-thread-49');
    assert.equal((await page.evaluate(() => window.historyHarness.calls())).some(cursor => cursor !== undefined), false);

    await page.keyboard.press('l');
    await page.waitForFunction(() => (document.activeElement as HTMLElement)?.dataset.messageId === 'm119');
    const initialViewport = await page.evaluate(() =>
        window.historyHarness.historyState('vim-thread-49').viewportIds);
    for (let index = 0; index < 25; index++) await page.keyboard.press('k');
    const historyScroll = await page.locator('.messages').evaluate(scroller => ({
        scrollTop: scroller.scrollTop,
        rect: scroller.getBoundingClientRect(),
        row: document.activeElement!.getBoundingClientRect(),
    }));
    assert.ok(historyScroll.scrollTop < 1_000_000);
    assert.ok(historyScroll.row.top >= historyScroll.rect.top - 1 && historyScroll.row.bottom <= historyScroll.rect.bottom + 1);
    assert.deepEqual(
        await page.evaluate(() => window.historyHarness.historyState('vim-thread-49').viewportIds),
        initialViewport,
    );
    assert.equal((await page.evaluate(() => window.historyHarness.calls())).some(cursor => cursor !== undefined), false);

    await page.keyboard.press('h');
    await page.waitForFunction(() => (document.activeElement as HTMLElement)?.dataset.threadId === 'vim-thread-49');
    await page.keyboard.press('l');
    await page.waitForFunction(() => (document.activeElement as HTMLElement)?.dataset.messageId === 'm94');
    await page.close();
});

test('Vim j and k establish the only chat and clamp at both boundaries', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.evaluate(() => window.historyHarness.showInbox());
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'thread');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'thread');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'thread');
    await page.close();
});

test('Vim keys honor DOM editing semantics including contenteditable variants', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    const variants = [
        '<div contenteditable></div>',
        '<div contenteditable=""></div>',
        '<div contenteditable="true"></div>',
        '<div contenteditable="plaintext-only"></div>',
        '<div contenteditable="true"><span></span></div>',
    ];
    for (const [index, markup] of variants.entries()) {
        await page.evaluate(({ index, markup }) => {
            const host = document.createElement('div');
            host.id = `editor-${index}`;
            host.innerHTML = markup;
            document.body.append(host);
            const editor = host.firstElementChild as HTMLElement;
            editor.focus();
            const span = host.querySelector('span');
            if (span) {
                const range = document.createRange();
                range.selectNodeContents(span);
                range.collapse(false);
                const selection = getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }
        }, { index, markup });
        await page.keyboard.press('j');
        assert.equal(await page.locator(`#editor-${index}`).textContent(), 'j', `contenteditable variant ${index}`);
    }
    for (const control of ['input', 'textarea', 'select']) {
        const allowed = await page.evaluate(control => {
            const element = document.createElement(control);
            if (element instanceof HTMLSelectElement) {
                element.append(new Option('one'), new Option('j option'));
            }
            document.body.append(element);
            element.focus();
            return element.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'j', bubbles: true, cancelable: true,
            }));
        }, control);
        assert.equal(allowed, true, `${control} keydown was intercepted`);
    }
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'editor-false';
        host.innerHTML = '<div contenteditable="true"><span contenteditable="false" tabindex="0"></span></div>';
        document.body.append(host);
        (host.querySelector('[contenteditable="false"]') as HTMLElement).focus();
    });
    await page.keyboard.press('j');
    assert.equal(await page.locator('#editor-false').textContent(), '');
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), 'second-thread');
    await page.close();
});

test('Vim history scrolling does not turn a top-boundary key into older pagination', async () => {
    const page = await openHarness({ width: 900, height: 420 });
    await page.evaluate(() => window.historyHarness.mount('delayed'));
    await page.locator('[data-message-id="m40"]').evaluate(row =>
        (row as HTMLElement).focus({ preventScroll: true }));
    const before = await page.evaluate(() => ({
        calls: window.historyHarness.calls(),
        viewportIds: window.historyHarness.historyState('thread').viewportIds,
    }));
    await page.keyboard.press('k');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm40');
    assert.deepEqual(await page.evaluate(() => window.historyHarness.calls()), before.calls);
    assert.deepEqual(
        await page.evaluate(() => window.historyHarness.historyState('thread').viewportIds),
        before.viewportIds,
    );
    await page.close();
});

test('stale pin-action restoration cannot steal newer chat or pane focus', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    await page.evaluate(() => window.historyHarness.showInbox());
    const first = page.locator('[data-thread-id="thread"]');
    const second = page.locator('[data-thread-id="second-thread"]');
    await first.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin conversation' }).evaluate((item, secondSelector) => {
        (item as HTMLElement).click();
        document.querySelector<HTMLElement>(secondSelector)!.focus();
    }, '[data-thread-id="second-thread"]');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.threadId), 'second-thread');

    await first.click();
    await first.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin conversation' }).evaluate(item => {
        (item as HTMLElement).click();
        document.querySelector<HTMLElement>('[data-message-id="m119"]')?.focus();
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.messageId), 'm119');
    await page.close();
});

test('selected chat exposes the same keyboard and pointer pin action', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('resize'));
    const selected = page.getByRole('button', { name: 'History harness', exact: true });
    const result = await selected.evaluate(element => ({
        pointerAllowed: element.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
        })),
        keyboardAllowed: element.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'F10',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        })),
    }));
    assert.deepEqual(result, { pointerAllowed: false, keyboardAllowed: false });
    const menu = page.getByRole('menu', { name: 'Actions for History harness' });
    await menu.waitFor();
    assert.equal(await menu.getByRole('menuitem', { name: 'Pin conversation' }).count(), 1);
    await page.close();
});

test('floating surfaces clamp and reposition within visual viewport offsets and dimensions', async () => {
    const page = await openHarness({ width: 900, height: 600 });
    await page.evaluate(() => {
        const viewport = new EventTarget() as EventTarget & {
            width: number;
            height: number;
            offsetLeft: number;
            offsetTop: number;
        };
        viewport.width = 320;
        viewport.height = 240;
        viewport.offsetLeft = 110;
        viewport.offsetTop = 70;
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        window.historyHarness.mount('thread-state');
    });
    const message = page.locator('[data-message-id="m80"]');
    await message.click({ button: 'right', position: { x: 2, y: 2 } });
    const menu = page.getByRole('menu', { name: 'Message actions' });
    await menu.waitFor();
    await page.waitForTimeout(250);
    const first = await menu.boundingBox();
    assert.ok(
        first && first.x >= 117.5 && first.y >= 77.5 && first.x + first.width <= 422.5 && first.y + first.height <= 302.5,
        `initial visual viewport placement was ${JSON.stringify(first)}`,
    );

    await page.evaluate(() => {
        const viewport = window.visualViewport! as VisualViewport & {
            width: number;
            height: number;
            offsetLeft: number;
            offsetTop: number;
        };
        viewport.width = 270;
        viewport.height = 180;
        viewport.offsetLeft = 180;
        viewport.offsetTop = 120;
        viewport.dispatchEvent(new Event('resize'));
        viewport.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(50);
    const second = await menu.boundingBox();
    assert.ok(second && second.x >= 187.5 && second.y >= 127.5 && second.x + second.width <= 442.5 && second.y + second.height <= 292.5);
    await page.close();
});

test('real browser touch movement or cancellation before the hold threshold cancels long-press', async () => {
    const page = await openTouchHarness({ width: 390, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.chat-row--selected'));
    await page.evaluate(() => window.historyHarness.showInbox());
    const chat = page.getByRole('button', { name: 'History harness', exact: true });
    const box = await chat.boundingBox();
    assert.ok(box);
    const point = { x: box!.x + 20, y: box!.y + 20 };
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x, y: point.y + 35, id: 1 }],
    });
    await page.waitForTimeout(550);
    assert.equal(await page.getByRole('menu', { name: 'Actions for History harness' }).count(), 0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(550);
    assert.equal(await page.getByRole('menu', { name: 'Actions for History harness' }).count(), 0);

    await page.close();
});

test('real held touch release over the opened action cannot activate it', async () => {
    const page = await openTouchHarness({ width: 390, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.chat-row--selected'));
    await page.evaluate(() => window.historyHarness.showInbox());
    await page.evaluate(() => {
        type CompatibilityEvent = { type: string; target: string; prevented: boolean };
        const state = window as typeof window & { compatibilityEvents?: CompatibilityEvent[] };
        state.compatibilityEvents = [];
        for (const type of ['click', 'contextmenu']) {
            document.addEventListener(type, event => {
                const record = {
                    type,
                    target: (event.target as Element | null)?.textContent?.trim() ?? '',
                    prevented: false,
                };
                state.compatibilityEvents!.push(record);
                setTimeout(() => { record.prevented = event.defaultPrevented; });
            }, true);
        }
    });
    const chat = page.getByRole('button', { name: 'History harness', exact: true });
    const box = await chat.boundingBox();
    assert.ok(box);
    const point = { x: box!.x + 20, y: box!.y + 20 };
    const cdp = await page.context().newCDPSession(page);

    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 2 }],
    });
    const menu = page.getByRole('menu', { name: 'Actions for History harness' });
    await menu.waitFor({ timeout: 1_000 });
    const item = menu.getByRole('menuitem', { name: 'Pin conversation' });
    const menuBox = await item.boundingBox();
    assert.ok(menuBox);
    const menuPoint = {
        x: menuBox!.x + 1,
        y: menuBox!.y + 1,
    };
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...menuPoint, id: 2 }],
    });
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), undefined);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), undefined);
    const compatibilityEvents = await page.evaluate(() =>
        (window as typeof window & {
            compatibilityEvents?: Array<{ type: string; target: string; prevented: boolean }>;
        }).compatibilityEvents ?? []);
    assert.ok(compatibilityEvents.length > 0, 'Chromium generated no compatibility event for the held release');
    assert.equal(
        compatibilityEvents.every(event => event.prevented),
        true,
        JSON.stringify(compatibilityEvents),
    );
    assert.equal(compatibilityEvents.some(event => event.target.includes('Pin conversation')), true);
    await item.click();
    await page.getByRole('button', { name: 'History harness, pinned', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.historyHarness.historyState('thread').selected), undefined);
    await page.close();
});

test('actionable message names are descriptive and stable reply props preserve memoized rows', async () => {
    const page = await openHarness();
    await page.evaluate(() => window.historyHarness.mount('mutations'));
    const row = page.locator('[data-message-id="m0"]');
    await row.waitFor();
    assert.match(await row.getAttribute('aria-label') ?? '', /Participant: message 0\. Delivered/);

    await page.evaluate(() => {
        const row = document.querySelector('[data-message-id="m0"]')!;
        const observer = new MutationObserver(records => {
            (window as typeof window & { messageRowMutationCount?: number }).messageRowMutationCount = records.length;
        });
        observer.observe(row, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    await page.getByRole('textbox', { name: 'Message' }).fill('memo check');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() =>
        (window as typeof window & { messageRowMutationCount?: number }).messageRowMutationCount ?? 0), 0);
    await page.close();
});

test('sending at bottom follows the outgoing message', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('mutations'));
    await page.locator('[data-message-id]').first().waitFor();
    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
    });
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('follow me');
    await composer.press('Enter');
    await page.locator('[data-message-id="server-1"]').waitFor();
    const distance = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    });
    assert.ok(distance <= 2, `bottom send ended ${distance}px from newest`);
    await page.close();
});

test('incoming messages follow at bottom and preserve a scrolled-up reader', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('mutations'));
    await page.locator('[data-message-id]').first().waitFor();
    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        window.historyHarness.applyIncoming('thread', 'incoming-bottom', 10_000);
    });
    await page.locator('[data-message-id="incoming-bottom"]').waitFor();
    const bottomDistance = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    });
    assert.ok(bottomDistance <= 2, `incoming bottom follow ended ${bottomDistance}px away`);

    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 250);
        scroller.dispatchEvent(new Event('scroll'));
        const top = scroller.getBoundingClientRect().top;
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > top)!;
        const result = {
            id: row.dataset.messageId!,
            top: row.getBoundingClientRect().top,
            viewportIds: window.historyHarness.historyState('thread').viewportIds,
        };
        window.historyHarness.applyIncoming('thread', 'incoming-scrolled', 11_000);
        return result;
    });
    await page.getByRole('button', { name: 'Go to newest message' }).waitFor();
    assert.equal(await page.locator('[data-message-id="incoming-scrolled"]').count(), 0);
    const afterTop = await page.locator(`[data-message-id="${before.id}"]`).evaluate(row =>
        row.getBoundingClientRect().top,
    );
    assert.ok(Math.abs(afterTop - before.top) < 1);
    assert.deepEqual(
        (await page.evaluate(() => window.historyHarness.historyState('thread'))).viewportIds,
        before.viewportIds,
    );
    await page.close();
});

test('incoming follow acknowledgement stays scoped to the retained thread pane', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    await page.locator('[data-message-id]').first().waitFor();

    const restored = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 300);
        scroller.dispatchEvent(new Event('scroll'));
        const scrollerTop = scroller.getBoundingClientRect().top;
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > scrollerTop)!;
        return {
            id: row.dataset.messageId!,
            offset: row.getBoundingClientRect().top - scrollerTop,
            distanceFromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
        };
    });
    assert.ok(restored.distanceFromBottom >= 250);

    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history');
    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        window.historyHarness.applyIncoming('second-thread', 'incoming-a', 200_000);
    });
    await page.locator('[data-message-id="incoming-a"]').waitFor();

    await page.evaluate(() => window.historyHarness.select('thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'History harness');
    await page.waitForTimeout(100);
    const afterReturn = await page.evaluate(id => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const row = scroller.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
        return {
            offset: row.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
            distanceFromBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
        };
    }, restored.id);
    assert.ok(Math.abs(afterReturn.offset - restored.offset) < 1);
    assert.ok(afterReturn.distanceFromBottom >= 250);
    assert.equal(await page.locator('[data-message-id="incoming-a"]').count(), 0);

    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        window.historyHarness.applyIncoming('thread', 'incoming-b', 201_000);
    });
    await page.locator('[data-message-id="incoming-b"]').waitFor();
    const finalDistance = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    });
    assert.ok(finalDistance <= 2, `fresh B follow ended ${finalDistance}px from newest`);
    await page.close();
});

test('sending while scrolled up preserves the logical viewport and offers newest navigation', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('mutations'));
    await page.locator('[data-message-id]').first().waitFor();
    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 300);
        scroller.dispatchEvent(new Event('scroll'));
        const top = scroller.getBoundingClientRect().top;
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > top)!;
        return {
            id: row.dataset.messageId!,
            top: row.getBoundingClientRect().top,
            viewportIds: window.historyHarness.historyState('thread').viewportIds,
        };
    });
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('do not jump');
    await composer.press('Enter');
    const newest = page.getByRole('button', { name: 'Go to newest message' });
    await newest.waitFor();
    assert.equal(await page.locator('[data-message-id="server-1"]').count(), 0);
    const after = await page.locator(`[data-message-id="${before.id}"]`).evaluate(row =>
        row.getBoundingClientRect().top,
    );
    assert.ok(Math.abs(after - before.top) < 1, `scrolled-up send drifted ${Math.abs(after - before.top)}px`);
    assert.deepEqual(
        (await page.evaluate(() => window.historyHarness.historyState('thread'))).viewportIds,
        before.viewportIds,
    );

    await page.locator(`[data-message-id="${before.id}"]`).click({ button: 'right' });
    await page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Reply' }).click();
    const cancelReply = page.getByRole('button', { name: 'Cancel reply' });
    await cancelReply.waitFor();
    const controls = await Promise.all([
        newest.evaluate(element => element.getBoundingClientRect()),
        cancelReply.evaluate(element => element.getBoundingClientRect()),
    ]);
    assert.ok(controls[0].bottom <= controls[1].top, 'newest navigation overlaps reply cancellation');
    await cancelReply.click();

    await newest.click();
    await page.locator('[data-message-id="server-1"]').waitFor();
    const distance = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    });
    assert.ok(distance <= 2, `newest navigation ended ${distance}px from bottom`);
    await page.close();
});

test('sending at the DOM bottom of an older local window preserves its anchor and reveals newest on demand', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('older-send'));
    await page.locator('[data-message-id]').first().waitFor();
    await page.evaluate(() => window.historyHarness.revealOlder('thread'));
    await page.waitForFunction(() =>
        window.historyHarness.historyState('thread').viewportIds?.[0] === 'm40' &&
        !window.historyHarness.historyState('thread').isReplacingViewport,
    );
    await page.evaluate(() => window.historyHarness.revealOlder('thread'));
    await page.waitForFunction(() =>
        window.historyHarness.historyState('thread').viewportIds?.at(-1) === 'm79' &&
        !window.historyHarness.historyState('thread').isReplacingViewport,
    );

    const before = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)!;
        return {
            id: row.dataset.messageId!,
            top: row.getBoundingClientRect().top,
            viewportIds: window.historyHarness.historyState('thread').viewportIds,
        };
    });
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('deferred');
    await composer.press('Enter');
    const localId = (await page.evaluate(() =>
        window.historyHarness.historyState('thread').listedIds?.at(-1)))!;
    assert.match(localId, /^local:/);
    assert.equal(await page.locator(`[data-message-id="${localId}"]`).count(), 0);
    await page.getByRole('button', { name: 'Go to newest message' }).waitFor();

    await page.evaluate(() => window.historyHarness.resolveSend());
    await page.waitForFunction(() =>
        window.historyHarness.historyState('thread').listedIds?.at(-1) === 'server-deferred',
    );
    assert.equal(await page.locator('[data-message-id="server-deferred"]').count(), 0);
    const after = await page.locator(`[data-message-id="${before.id}"]`).evaluate(row =>
        row.getBoundingClientRect().top,
    );
    assert.ok(Math.abs(after - before.top) < 1, `older-window send drifted ${Math.abs(after - before.top)}px`);
    assert.deepEqual(
        (await page.evaluate(() => window.historyHarness.historyState('thread'))).viewportIds,
        before.viewportIds,
    );

    await page.getByRole('button', { name: 'Go to newest message' }).click();
    await page.locator('[data-message-id="server-deferred"]').waitFor();
    const revealed = await page.evaluate(() => {
        const state = window.historyHarness.historyState('thread');
        const domIds = [...document.querySelectorAll<HTMLElement>('[data-message-id]')]
            .map(row => row.dataset.messageId!);
        const listed = state.listedIds!;
        return {
            viewportIds: state.viewportIds,
            domIds,
            expected: listed.slice(-40),
            distance: (() => {
                const scroller = document.querySelector<HTMLElement>('.messages')!;
                return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            })(),
        };
    });
    assert.deepEqual(revealed.viewportIds, revealed.expected);
    assert.deepEqual(revealed.domIds, revealed.expected);
    assert.ok(revealed.domIds.length <= 80);
    assert.ok(revealed.distance <= 2);
    await page.close();
});

test('programmatic follow is thread-scoped during a rapid switch', async () => {
    const page = await openHarness({ width: 900, height: 520 });
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history' &&
        document.querySelectorAll('[data-message-id]').length > 0,
    );
    const saved = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 320);
        scroller.dispatchEvent(new Event('scroll'));
        const row = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
            .find(item => item.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top)!;
        return { id: row.dataset.messageId!, top: row.getBoundingClientRect().top };
    });
    await page.evaluate(() => window.historyHarness.select('thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'History harness',
    );
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('rapid switch');
    await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        scroller.scrollTop = scroller.scrollHeight;
        document.querySelector<HTMLTextAreaElement>('.composer textarea')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
        window.historyHarness.select('second-thread');
    });
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history',
    );
    const restored = await page.evaluate(id => {
        const scroller = document.querySelector<HTMLElement>('.messages')!;
        const row = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)!;
        return {
            top: row.getBoundingClientRect().top,
            distance: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
        };
    }, saved.id);
    assert.ok(Math.abs(restored.top - saved.top) < 1, `rapid switch drifted ${Math.abs(restored.top - saved.top)}px`);
    assert.ok(restored.distance > 100, 'follow state leaked into the restored thread');
    await page.close();
});

test('controlled drafts and composer actions remain per-thread and operable at narrow width', async () => {
    const page = await openHarness({ width: 320, height: 640 });
    await page.evaluate(() => window.historyHarness.mount('thread-state'));
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('draft one');
    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history',
    );
    assert.equal(await composer.inputValue(), '');
    await composer.fill('draft two');
    await page.evaluate(() => window.historyHarness.select('thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'History harness',
    );
    assert.equal(await composer.inputValue(), 'draft one');
    await page.evaluate(() => window.historyHarness.select('second-thread'));
    await page.waitForFunction(() =>
        document.querySelector('.conversation__header h2')?.textContent === 'Second history',
    );
    assert.equal(await composer.inputValue(), 'draft two');

    const send = page.getByRole('button', { name: 'Send' });
    const controlsFit = await page.evaluate(() => {
        const textarea = document.querySelector<HTMLElement>('.composer textarea')!.getBoundingClientRect();
        const sendButton = document.querySelector<HTMLElement>('.composer button[type="submit"]')!.getBoundingClientRect();
        return textarea.left >= 0 && sendButton.right <= innerWidth && textarea.width > 80 && sendButton.width > 0;
    });
    assert.equal(controlsFit, true);
    await send.click();
    await page.locator('[data-message-id="server-1"]').waitFor();

    assert.equal(await page.getByRole('button', { name: 'Message actions' }).count(), 0);
    assert.equal(await page.getByText('•••', { exact: true }).count(), 0);
    const newestMessage = page.locator('[data-message-id="server-1"]');
    const box = await newestMessage.boundingBox();
    assert.ok(box);
    const outgoingAlignment = await newestMessage.evaluate(element => {
        const bubble = element.querySelector('.message__bubble')!.getBoundingClientRect();
        const trigger = element.querySelector('.message__reaction-rail')!.getBoundingClientRect();
        return {
            bubbleLeft: bubble.left,
            bubbleRight: bubble.right,
            triggerLeft: trigger.left,
            triggerRight: trigger.right,
            viewportWidth: innerWidth,
        };
    });
    assert.ok(outgoingAlignment.triggerLeft >= outgoingAlignment.bubbleLeft);
    assert.ok(outgoingAlignment.triggerRight <= outgoingAlignment.bubbleRight);
    assert.ok(outgoingAlignment.triggerRight <= outgoingAlignment.viewportWidth);
    await newestMessage.dispatchEvent('pointerdown', {
        pointerType: 'touch', pointerId: 6, isPrimary: true, clientX: box!.x + 12, clientY: box!.y + 12,
    });
    await newestMessage.dispatchEvent('pointermove', {
        pointerType: 'touch', pointerId: 6, isPrimary: true, clientX: box!.x + 30, clientY: box!.y + 30,
    });
    await page.waitForTimeout(550);
    assert.equal(await page.getByRole('menu', { name: 'Message actions' }).count(), 0);
    await newestMessage.dispatchEvent('pointerdown', {
        pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: box!.x + 12, clientY: box!.y + 12,
    });
    await page.waitForTimeout(550);
    await newestMessage.dispatchEvent('pointerup', {
        pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: box!.x + 12, clientY: box!.y + 12,
    });
    const messageMenu = page.getByRole('menu', { name: 'Message actions' });
    assert.deepEqual(await messageMenu.getByRole('menuitem').allTextContents(), ['Reply']);
    await page.keyboard.press('Escape');
    await messageMenu.waitFor({ state: 'detached' });
    await page.waitForTimeout(850);
    await newestMessage.focus();
    await newestMessage.hover();
    await newestMessage.locator('.message__reaction-default').hover();
    await newestMessage.locator('.message__reaction-expander').click();
    const picker = page.getByRole('menu', { name: 'Choose a reaction' });
    await picker.waitFor();
    const pickerFits = await picker.evaluate(element => {
        const buttons = [...element.querySelectorAll('button')];
        return buttons.length === 18 && buttons.every(button => {
            const rect = button.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0 && rect.height > 0;
        });
    });
    assert.equal(pickerFits, true);
    await picker.getByRole('menuitemradio', { name: 'React with 👍' }).click();
    await page.locator('.reaction-chip--viewer').last().waitFor();
    await page.close();
});

async function openHarness(viewport = { width: 900, height: 500 }): Promise<Page> {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}tests/history-harness.html`);
    await page.waitForFunction(() => Boolean(window.historyHarness));
    return page;
}

async function openTouchHarness(viewport: { width: number; height: number }): Promise<Page> {
    const page = await browser.newPage({ viewport, hasTouch: true });
    await page.goto(`${baseUrl}tests/history-harness.html`);
    await page.waitForFunction(() => Boolean(window.historyHarness));
    return page;
}
