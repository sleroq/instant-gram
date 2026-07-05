<script lang="ts">
  import '../../lib/bridge';
  import { sendMessage } from 'webext-bridge/popup';
  import type { Page, ReelMedia, Result, RpcMap, Thread, ThreadMessages } from '../../lib/domain';
  import MessageList from './MessageList.svelte';
  import ThreadList from './ThreadList.svelte';
  import type { View } from './types';

  let inbox = $state<View<Page<Thread>>>({ state: 'loading' });
  let selected = $state<Thread | undefined>();
  let threads = $state<Record<string, View<ThreadMessages>>>({});
  let pinned = $state<string[]>([]);
  let reel = $state<View<ReelMedia> & { shortcode?: string }>({ state: 'idle' });

  function unwrap<T>(result: Result<T>): T {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  type RpcPayload<K extends keyof RpcMap> = Parameters<RpcMap[K]> extends [] ? undefined : Parameters<RpcMap[K]>[0];

  async function rpc<K extends keyof RpcMap>(name: K, payload: RpcPayload<K>): Promise<ReturnType<RpcMap[K]>> {
    switch (name) {
      case 'getInbox':
        return sendMessage<Result<Page<Thread>>, 'getInbox'>(name, payload as RpcPayload<'getInbox'>, 'background') as Promise<ReturnType<RpcMap[K]>>;
      case 'getThread':
        return sendMessage<Result<ThreadMessages>, 'getThread'>(name, payload as RpcPayload<'getThread'>, 'background') as Promise<ReturnType<RpcMap[K]>>;
      case 'getReelMedia':
        return sendMessage<Result<ReelMedia>, 'getReelMedia'>(name, payload as RpcPayload<'getReelMedia'>, 'background') as Promise<ReturnType<RpcMap[K]>>;
      case 'getPins':
        return sendMessage<{ pinned: string[] }, 'getPins'>(name, null, 'background') as Promise<ReturnType<RpcMap[K]>>;
      case 'togglePin':
        return sendMessage<{ pinned: string[] }, 'togglePin'>(name, payload as RpcPayload<'togglePin'>, 'background') as Promise<ReturnType<RpcMap[K]>>;
    }
  }

  async function loadInbox(cursor?: string) {
    if (!cursor) inbox = { state: 'loading' };
    try {
      const page = unwrap(await rpc('getInbox', cursor ? { cursor } : {}));
      inbox = cursor && inbox.state === 'ready'
        ? { state: 'ready', data: { ...page, items: [...inbox.data.items, ...page.items] } }
        : { state: 'ready', data: page };
    } catch (error) {
      inbox = { state: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function loadPins() {
    pinned = (await rpc('getPins', undefined)).pinned;
  }

  async function togglePin(threadKey: string, event: MouseEvent) {
    event.stopPropagation();
    pinned = (await rpc('togglePin', { threadKey })).pinned;
  }

  const sortedThreads = $derived(inbox.state === 'ready' ? [...inbox.data.items].sort((a, b) => {
    const ap = pinned.indexOf(a.key); const bp = pinned.indexOf(b.key);
    if (ap !== -1 || bp !== -1) return (ap === -1 ? 9999 : ap) - (bp === -1 ? 9999 : bp);
    if (a.serverIsPin !== b.serverIsPin) return a.serverIsPin ? -1 : 1;
    return b.lastActivityMs - a.lastActivityMs;
  }) : []);

  async function selectThread(thread: Thread) {
    selected = thread;
    const key = thread.key;
    if (!threads[key]) {
      threads[key] = { state: 'loading' };
      try {
        threads[key] = { state: 'ready', data: unwrap(await rpc('getThread', { threadKey: thread.cursor ?? thread.key })) };
      } catch (error) {
        threads[key] = { state: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  function updateThreadPageInfo(current: ThreadMessages, page: ThreadMessages): ThreadMessages {
    return {
      ...current,
      cursor: page.cursor,
      hasNextPage: page.hasNextPage,
      thread: current.thread ?? page.thread,
      viewerId: current.viewerId,
    };
  }

  async function loadEarlierMessages(thread: Thread, beforeLoad: () => Promise<void>, limit: number): Promise<ThreadMessages[]> {
    const key = thread.key;
    const current = threads[key];
    if (current?.state !== 'ready' || !current.data.hasNextPage || !current.data.cursor) return [];

    await beforeLoad();
    const threadKey = current.data.thread?.cursor ?? thread.cursor ?? thread.key;
    let cursor: string | undefined = current.data.cursor;
    let pageInfo = current.data;
    const pages: ThreadMessages[] = [];

    for (let i = 0; i < limit && pageInfo.hasNextPage && cursor; i++) {
      const page: ThreadMessages = unwrap(await rpc('getThread', { threadKey, cursor }));
      pages.push(page);
      pageInfo = updateThreadPageInfo(pageInfo, page);
      cursor = page.cursor;
    }

    const latest = threads[key];
    if (latest?.state !== 'ready') return pages;

    threads[key] = { state: 'ready', data: { ...latest.data, cursor: pageInfo.cursor, hasNextPage: pageInfo.hasNextPage, thread: latest.data.thread ?? pageInfo.thread } };
    return pages;
  }

  async function openReel(shortcode: string, mediaId?: string) {
    reel = { state: 'loading', shortcode };
    try {
      reel = { state: 'ready', shortcode, data: unwrap(await rpc('getReelMedia', mediaId ? { shortcode, mediaId } : { shortcode })) };
    } catch (error) {
      reel = { state: 'error', shortcode, message: error instanceof Error ? error.message : String(error) };
    }
  }

  loadPins(); loadInbox();
</script>

<main class="app">
  <ThreadList {inbox} threads={sortedThreads} {selected} {pinned} onselect={selectThread} ontogglepin={togglePin} onloadmore={() => loadInbox(inbox.state === 'ready' ? inbox.data.cursor : undefined)} />
  {#key selected?.key}
    <MessageList {selected} data={selected ? threads[selected.key] : undefined} onopenreel={openReel} onloadearlier={(beforePrepend, limit) => selected ? loadEarlierMessages(selected, beforePrepend, limit) : Promise.resolve([])} />
  {/key}
</main>

{#if reel.state !== 'idle'}
  <div class="modal" role="dialog" tabindex="-1" onclick={() => reel = { state: 'idle' }} onkeydown={(event) => event.key === 'Escape' && (reel = { state: 'idle' })}>
    <section class="modal-card">
      {#if reel.state === 'loading'}Loading reel…{:else if reel.state === 'error'}<p class="error">{reel.message}</p>{:else}<video controls autoplay muted src={reel.data.videoUrl}></video>{/if}
    </section>
  </div>
{/if}
