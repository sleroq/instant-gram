<script lang="ts">
  import '../../lib/bridge';
  import { sendMessage } from 'webext-bridge/popup';
  import { tick } from 'svelte';
  import type { Page, ReelMedia, Result, Thread, ThreadMessages } from '../../lib/domain';
  import MessageList from './MessageList.svelte';
  import ThreadList from './ThreadList.svelte';
  import type { ThreadCacheEntry, View } from './types';

  type JsonPayload = null | boolean | number | string | JsonPayload[] | { [key: string]: JsonPayload };
  const TOP_PRELOAD_BUFFER_PX = 200;
  const BOTTOM_SCROLL_MS = 180;

  let inbox = $state<View<Page<Thread>>>({ state: 'loading' });
  let selected = $state<Thread | undefined>();
  let selectedKey = $state<string | undefined>();
  let threadCache = $state<Record<string, ThreadCacheEntry>>({});
  let pinned = $state<string[]>([]);
  let reel = $state<View<ReelMedia> & { shortcode?: string }>({ state: 'idle' });
  let messagesEl = $state<HTMLDivElement>();
  let jumpingToBottom = false;
  let nextThreadRequestId = 0;

  const sortedThreads = $derived(inbox.state === 'ready' ? [...inbox.data.items].sort((a, b) => {
    const ap = pinned.indexOf(a.key); const bp = pinned.indexOf(b.key);
    if (ap !== -1 || bp !== -1) return (ap === -1 ? 9999 : ap) - (bp === -1 ? 9999 : bp);
    if (a.serverIsPin !== b.serverIsPin) return a.serverIsPin ? -1 : 1;
    return b.lastActivityMs - a.lastActivityMs;
  }) : []);
  const activeMessages = $derived(selectedKey ? threadCache[selectedKey] : undefined);

  function unwrap<T>(result: Result<T>): T {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  async function rpc<T>(name: string, payload: JsonPayload): Promise<T> {
    return sendMessage(name, payload, 'background') as Promise<T>;
  }

  async function loadInbox(cursor?: string) {
    if (!cursor) inbox = { state: 'loading' };
    try {
      const page = unwrap(await rpc<Result<Page<Thread>>>('getInbox', cursor ? { cursor } : {}));
      inbox = inbox.state === 'ready' && cursor ? { state: 'ready', data: { ...page, items: [...inbox.data.items, ...page.items] } } : { state: 'ready', data: page };
    } catch (error) { inbox = { state: 'error', message: error instanceof Error ? error.message : String(error) }; }
  }

  async function loadPins() { pinned = (await rpc<{ pinned: string[] }>('getPins', null)).pinned; }

  async function togglePin(threadKey: string, event: MouseEvent) {
    event.stopPropagation();
    pinned = (await rpc<{ pinned: string[] }>('togglePin', { threadKey })).pinned;
  }

  function emptyThreadEntry(): ThreadCacheEntry {
    return {
      state: 'idle',
      loadingOlder: false,
      hasNextPage: false,
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      isAtBottom: true,
      didInitialScroll: false,
    };
  }

  function cacheEntry(key: string): ThreadCacheEntry {
    return threadCache[key] ?? (threadCache[key] = emptyThreadEntry());
  }

  function mergeOlderMessages(current: ThreadMessages, page: ThreadMessages): ThreadMessages {
    const existingIds = new Set(current.items.map(message => message.id));
    const olderItems = page.items.filter(message => !existingIds.has(message.id));
    return {
      ...page,
      thread: current.thread ?? page.thread,
      viewerId: current.viewerId,
      items: [...olderItems, ...current.items]
    };
  }

  function readScrollState(): Pick<ThreadCacheEntry, 'scrollTop' | 'scrollHeight' | 'clientHeight' | 'isAtBottom'> | undefined {
    if (!messagesEl) return undefined;
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    return {
      scrollTop: messagesEl.scrollTop,
      scrollHeight: messagesEl.scrollHeight,
      clientHeight: messagesEl.clientHeight,
      isAtBottom: distanceFromBottom < 48,
    };
  }

  function firstVisibleMessageAnchor(): { id: string; offset: number } | undefined {
    if (!messagesEl) return undefined;
    const containerTop = messagesEl.getBoundingClientRect().top;
    const rows = messagesEl.querySelectorAll<HTMLElement>('.message-row[data-message-id]');
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom >= containerTop) {
        const id = row.dataset.messageId;
        return id ? { id, offset: rect.top - containerTop } : undefined;
      }
    }
    return undefined;
  }

  function restoreMessageAnchor(anchor: { id: string; offset: number }) {
    if (!messagesEl) return;
    const row = messagesEl.querySelector<HTMLElement>(`.message-row[data-message-id="${CSS.escape(anchor.id)}"]`);
    if (!row) return;
    const containerTop = messagesEl.getBoundingClientRect().top;
    messagesEl.scrollTop += row.getBoundingClientRect().top - containerTop - anchor.offset;
  }

  function saveActiveScroll() {
    if (!selectedKey) return;
    const scroll = readScrollState();
    if (!scroll) return;
    const entry = threadCache[selectedKey] ?? emptyThreadEntry();
    threadCache[selectedKey] = { ...entry, ...scroll };
  }

  function handleMessagesScroll() {
    saveActiveScroll();
    if (jumpingToBottom) return;
    void maybePreloadOlder();
  }

  async function maybePreloadOlder() {
    if (!messagesEl) return;
    if (messagesEl.scrollTop > TOP_PRELOAD_BUFFER_PX) return;
    await loadOlder();
  }

  async function restoreThreadScroll(key: string) {
    await tick();
    const entry = threadCache[key];
    if (!entry || !messagesEl) return;
    messagesEl.scrollTop = entry.isAtBottom ? messagesEl.scrollHeight : entry.scrollTop;
    const scroll = readScrollState();
    if (scroll) threadCache[key] = { ...entry, ...scroll };
  }

  async function scrollThreadToBottom(key: string) {
    await tick();
    const entry = threadCache[key];
    if (!entry || !messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    const scroll = readScrollState();
    if (scroll) threadCache[key] = { ...entry, ...scroll, didInitialScroll: true };
  }

  async function scrollActiveThreadToBottom() {
    if (!selectedKey || !messagesEl) return;
    const key = selectedKey;
    jumpingToBottom = true;
    await animateScrollToBottom();
    jumpingToBottom = false;
    if (selectedKey !== key) return;
    const entry = threadCache[key];
    const scroll = readScrollState();
    if (entry && scroll) threadCache[key] = { ...entry, ...scroll };
  }

  function animateScrollToBottom(): Promise<void> {
    return new Promise(resolve => {
      if (!messagesEl) {
        resolve();
        return;
      }
      const startTop = messagesEl.scrollTop;
      const startTime = performance.now();
      const check = () => {
        if (!messagesEl) {
          resolve();
          return;
        }
        const targetTop = messagesEl.scrollHeight;
        const progress = Math.min(1, (performance.now() - startTime) / BOTTOM_SCROLL_MS);
        messagesEl.scrollTop = startTop + (targetTop - startTop) * progress;
        if (progress === 1) {
          messagesEl.scrollTop = messagesEl.scrollHeight;
          resolve();
          return;
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  async function selectThread(thread: Thread) {
    saveActiveScroll();
    selected = thread;
    selectedKey = thread.key;
    const entry = cacheEntry(thread.key);
    if (entry.data) {
      await restoreThreadScroll(thread.key);
      return;
    }

    const requestId = ++nextThreadRequestId;
    threadCache[thread.key] = { ...entry, state: 'loading-initial', error: undefined, requestId };
    try {
      const data = unwrap(await rpc<Result<ThreadMessages>>('getThread', { threadKey: thread.cursor ?? thread.key }));
      if (threadCache[thread.key]?.requestId !== requestId) return;
      threadCache[thread.key] = {
        state: 'ready',
        data,
        loadingOlder: false,
        cursor: data.cursor,
        hasNextPage: data.hasNextPage,
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        isAtBottom: true,
        didInitialScroll: false,
      };
      if (selectedKey === thread.key) await scrollThreadToBottom(thread.key);
    } catch (error) {
      if (threadCache[thread.key]?.requestId !== requestId) return;
      threadCache[thread.key] = {
        ...threadCache[thread.key],
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
        loadingOlder: false,
      };
    }
  }

  async function loadOlder() {
    if (!selected || !selectedKey) return;
    const key = selectedKey;
    const threadKey = selected.cursor ?? selected.key;
    const entry = threadCache[key];
    if (!entry?.data || !entry.cursor || !entry.hasNextPage || entry.loadingOlder) return;
    const anchor = firstVisibleMessageAnchor();
    threadCache[key] = { ...entry, loadingOlder: true, error: undefined };
    try {
      const page = unwrap(await rpc<Result<ThreadMessages>>('getThread', { threadKey, cursor: entry.cursor }));
      const latest = threadCache[key];
      if (!latest?.data) return;
      const data = mergeOlderMessages(latest.data, page);
      threadCache[key] = {
        ...latest,
        state: 'ready',
        data,
        loadingOlder: false,
        cursor: data.cursor,
        hasNextPage: data.hasNextPage,
      };
      await tick();
      if (messagesEl) {
        if (anchor) restoreMessageAnchor(anchor);
        const scroll = readScrollState();
        if (scroll) threadCache[key] = { ...threadCache[key], ...scroll };
      }
      if (selectedKey === key) void maybePreloadOlder();
    } catch (error) {
      const latest = threadCache[key];
      if (!latest) return;
      threadCache[key] = {
        ...latest,
        state: latest.data ? 'ready' : 'error',
        error: error instanceof Error ? error.message : String(error),
        loadingOlder: false,
      };
    }
  }

  async function openReel(shortcode: string, mediaId?: string) {
    reel = { state: 'loading', shortcode };
    try { reel = { state: 'ready', shortcode, data: unwrap(await rpc<Result<ReelMedia>>('getReelMedia', mediaId ? { shortcode, mediaId } : { shortcode })) }; }
    catch (error) { reel = { state: 'error', shortcode, message: error instanceof Error ? error.message : String(error) }; }
  }

  loadPins(); loadInbox();
</script>

<main class="app">
  <ThreadList {inbox} threads={sortedThreads} {selected} {pinned} onselect={selectThread} ontogglepin={togglePin} onloadmore={() => loadInbox(inbox.state === 'ready' ? inbox.data.cursor : undefined)} />
  <MessageList {selected} entry={activeMessages} bind:messagesEl onscroll={handleMessagesScroll} onopenreel={openReel} onscrollbottom={scrollActiveThreadToBottom} />
</main>

{#if reel.state !== 'idle'}
  <div class="modal" role="dialog" tabindex="-1" onclick={() => reel = { state: 'idle' }} onkeydown={(event) => event.key === 'Escape' && (reel = { state: 'idle' })}>
    <section class="modal-card">
      {#if reel.state === 'loading'}Loading reel…{:else if reel.state === 'error'}<p class="error">{reel.message}</p>{:else}<video controls autoplay muted src={reel.data.videoUrl}></video>{/if}
    </section>
  </div>
{/if}
