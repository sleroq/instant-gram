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
    const reactionAffordance = page.locator('[data-message-id="m0"] .message__reaction-trigger');
    assert.equal(await reactionAffordance.evaluate(element => getComputedStyle(element).opacity), '0');
    await page.locator('[data-message-id="m0"] .message__bubble').hover();
    await page.waitForFunction(() => getComputedStyle(
        document.querySelector('[data-message-id="m0"] .message__reaction-trigger')!,
    ).opacity === '1');
    const incomingAlignment = await page.locator('[data-message-id="m0"]').evaluate(element => {
        const bubble = element.querySelector('.message__bubble')!.getBoundingClientRect();
        const trigger = element.querySelector('.message__reaction-trigger')!.getBoundingClientRect();
        return { bubbleRight: bubble.right, triggerLeft: trigger.left };
    });
    assert.ok(incomingAlignment.triggerLeft >= incomingAlignment.bubbleRight);
    await reactionAffordance.click();
    await page.getByRole('menu', { name: 'Choose a reaction' }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-message-id="m0"]').focus();
    assert.equal(await reactionAffordance.evaluate(element => getComputedStyle(element).opacity), '1');

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

    await page.locator('[data-message-id="m0"]').click({ button: 'right' });
    await page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Add reaction' }).click();
    const picker = page.getByRole('menu', { name: 'Choose a reaction' });
    await picker.waitFor();
    assert.equal(await picker.getByRole('menuitemradio').count(), 6);
    await picker.getByRole('menuitemradio', { name: 'React with ❤' }).press('ArrowRight');
    await page.getByRole('menuitemradio', { name: 'React with 😂' }).press('Enter');
    await page.locator('.reaction-chip--viewer').first().waitFor();
    assert.match(
        await page.locator('.reaction-chip--viewer').first().getAttribute('aria-label') ?? '',
        /including yours/,
    );
    await page.locator('[data-message-id="m0"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Change reaction 😂' }).click();
    const currentReaction = page.getByRole('menuitemradio', { name: '😂, current reaction' });
    await currentReaction.waitFor();
    assert.equal(await currentReaction.getAttribute('aria-checked'), 'true');
    assert.equal(await currentReaction.isDisabled(), true);
    const earlierReaction = page.getByRole('menuitemradio', { name: 'React with ❤' });
    const laterReaction = page.getByRole('menuitemradio', { name: 'React with 😮' });
    await earlierReaction.press('ArrowRight');
    assert.equal(await laterReaction.evaluate(element => element === document.activeElement), true);
    await laterReaction.press('ArrowLeft');
    assert.equal(await earlierReaction.evaluate(element => element === document.activeElement), true);
    await earlierReaction.press('End');
    assert.equal(await page.getByRole('menuitemradio', { name: 'React with 👍' }).evaluate(
        element => element === document.activeElement,
    ), true);
    await page.getByRole('menuitemradio', { name: 'React with 👍' }).press('Home');
    assert.equal(await earlierReaction.evaluate(element => element === document.activeElement), true);
    await earlierReaction.press('ArrowRight');
    await laterReaction.press('Enter');
    await page.waitForFunction(() => document.querySelector('.reaction-chip--viewer')?.textContent?.includes('😮'));

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
    await chatMenu.getByRole('menuitem', { name: 'Open conversation' }).click();
    await page.waitForFunction(() => document.querySelector('.conversation__header h2')?.textContent === 'Second history');
    await page.close();
});

test('selected chat leaves native context menu semantics untouched', async () => {
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
    assert.deepEqual(result, { pointerAllowed: true, keyboardAllowed: true });
    assert.equal(await page.getByRole('menu', { name: 'Actions for History harness' }).count(), 0);
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
    const item = menu.getByRole('menuitem', { name: 'Open conversation' });
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
    assert.equal(compatibilityEvents.some(event => event.target.includes('Open conversation')), true);
    await item.click();
    await page.waitForFunction(() => window.historyHarness.historyState('thread').selected === 'thread');
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
    await page.getByRole('button', { name: 'Go to newest message' }).waitFor();
    assert.equal(await page.locator('[data-message-id="server-1"]').count(), 0);
    const after = await page.locator(`[data-message-id="${before.id}"]`).evaluate(row =>
        row.getBoundingClientRect().top,
    );
    assert.ok(Math.abs(after - before.top) < 1, `scrolled-up send drifted ${Math.abs(after - before.top)}px`);
    assert.deepEqual(
        (await page.evaluate(() => window.historyHarness.historyState('thread'))).viewportIds,
        before.viewportIds,
    );

    await page.getByRole('button', { name: 'Go to newest message' }).click();
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
        const trigger = element.querySelector('.message__reaction-trigger')!.getBoundingClientRect();
        return { bubbleLeft: bubble.left, triggerRight: trigger.right };
    });
    assert.ok(outgoingAlignment.triggerRight <= outgoingAlignment.bubbleLeft);
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
    await page.getByRole('menu', { name: 'Message actions' }).getByRole('menuitem', { name: 'Add reaction' }).click();
    const picker = page.getByRole('menu', { name: 'Choose a reaction' });
    await picker.waitFor();
    const pickerFits = await picker.evaluate(element => {
        const buttons = [...element.querySelectorAll('button')];
        return buttons.length === 6 && buttons.every(button => {
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
