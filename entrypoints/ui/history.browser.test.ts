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

test('dark desktop shell keeps floating fixed geometry and rounded selection', async () => {
    const page = await openHarness({ width: 1200, height: 700 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('.chat-row--selected'));
    const result = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const shell = document.querySelector<HTMLElement>('.app-shell')!;
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const header = document.querySelector<HTMLElement>('.conversation__header')!;
        const selected = document.querySelector<HTMLElement>('.chat-row--selected')!;
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

test('intermediate shell clamps the non-resizable sidebar without horizontal overflow', async () => {
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
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    });
    assert.ok(result.sidebarWidth >= 280 && result.sidebarWidth < 390);
    assert.ok(result.conversationWidth > 300);
    assert.equal(result.resize, 'none');
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

    await page.getByRole('button', { name: 'History harness' }).click();
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

test('short viewport removes outer chrome while preserving internal message scrolling', async () => {
    const page = await openHarness({ width: 900, height: 360 });
    await page.evaluate(() => window.historyHarness.mount('resize'));
    await page.waitForFunction(() => document.querySelector('[data-message-id]'));
    const result = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const messages = document.querySelector<HTMLElement>('.messages')!;
        const rect = messages.getBoundingClientRect();
        return {
            shellPadding: getComputedStyle(document.querySelector('.app-shell')!).padding,
            sidebarRadius: getComputedStyle(sidebar).borderRadius,
            sidebarShadow: getComputedStyle(sidebar).boxShadow,
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
    assert.ok(result.messageTop >= 64 && result.messageBottom <= 360);
    assert.ok(result.messageHeight > 100);
    assert.equal(result.scrollable, true);
    assert.ok(result.overflow <= 0);
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

async function openHarness(viewport = { width: 900, height: 500 }): Promise<Page> {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseUrl}tests/history-harness.html`);
    await page.waitForFunction(() => Boolean(window.historyHarness));
    return page;
}
