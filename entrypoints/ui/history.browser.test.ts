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

async function openHarness(): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.goto(`${baseUrl}tests/history-harness.html`);
    await page.waitForFunction(() => Boolean(window.historyHarness));
    return page;
}
