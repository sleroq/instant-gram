<script lang="ts">
  import '../../lib/bridge';
  import { sendMessage } from 'webext-bridge/popup';
  import type { Message, Page, ReelMedia, Result, Thread, ThreadMessages } from '../../lib/domain';

  type JsonPayload = null | boolean | number | string | JsonPayload[] | { [key: string]: JsonPayload };

  type View<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };
  type ThreadCacheEntry = {
    state: 'idle' | 'loading-initial' | 'ready' | 'error';
    data?: ThreadMessages;
    error?: string;
    loadingOlder: boolean;
    cursor?: string;
    hasNextPage: boolean;
    requestId?: number;
  };

  let inbox = $state<View<Page<Thread>>>({ state: 'loading' });
  let selected = $state<Thread | undefined>();
  let selectedKey = $state<string | undefined>();
  let threadCache = $state<Record<string, ThreadCacheEntry>>({});
  let pinned = $state<string[]>([]);
  let reel = $state<View<ReelMedia> & { shortcode?: string }>({ state: 'idle' });
  let nextThreadRequestId = 0;

  const sortedThreads = $derived(inbox.state === 'ready' ? [...inbox.data.items].sort((a, b) => {
    const ap = pinned.indexOf(a.key); const bp = pinned.indexOf(b.key);
    if (ap !== -1 || bp !== -1) return (ap === -1 ? 9999 : ap) - (bp === -1 ? 9999 : bp);
    if (a.serverIsPin !== b.serverIsPin) return a.serverIsPin ? -1 : 1;
    return b.lastActivityMs - a.lastActivityMs;
  }) : []);
  const activeMessages = $derived(selectedKey ? threadCache[selectedKey] : undefined);

  function snippet(message?: Message): string {
    if (!message) return '';
    switch (message.kind) {
      case 'text': return message.text;
      case 'reaction_log': return message.fragment;
      case 'reel_share': return `Reel from ${message.author}`;
      case 'unsupported': return message.contentType;
    }
  }

  function unwrap<T>(result: Result<T>): T {
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  function senderId(message: Message | undefined): string | undefined {
    return message && 'senderId' in message && message.senderId.length > 0 ? message.senderId : undefined;
  }

  function isMine(message: Message, viewerId: string): boolean {
    return senderId(message) === viewerId;
  }

  function senderAvatar(message: Message, thread?: Thread): string | undefined {
    const id = senderId(message);
    return id ? thread?.users.find(user => user.id === id)?.picUrl ?? undefined : undefined;
  }

  function showSenderAvatar(message: Message, next: Message | undefined, data: ThreadMessages): boolean {
    const id = senderId(message);
    return Boolean(id && id !== data.viewerId && id !== senderId(next));
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
    return { state: 'idle', loadingOlder: false, hasNextPage: false };
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

  async function selectThread(thread: Thread) {
    selected = thread;
    selectedKey = thread.key;
    const entry = cacheEntry(thread.key);
    if (entry.data) return;

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
      };
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
    if (!entry?.data || !entry.cursor || entry.loadingOlder) return;
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
  <aside class="sidebar">
    {#if inbox.state === 'loading'}<p class="empty">Loading chats…</p>
    {:else if inbox.state === 'error'}
      <p class="error">{inbox.message}</p>
    {:else if inbox.state === 'ready'}
      {#each sortedThreads as thread (thread.key)}
        <div class:selected={selected?.key === thread.key} class="thread" role="button" tabindex="0" onclick={() => selectThread(thread)} onkeydown={(event) => event.key === 'Enter' && selectThread(thread)}>
          <img class="avatar" src={thread.users[0]?.picUrl ?? ''} alt="" />
          <span class="thread-text"><span class="title">{thread.title}</span><br /><span class="snippet">{snippet(thread.lastMessage)}</span></span>
          <button class="pin" title="Pin" onclick={(event) => togglePin(thread.key, event)}>{pinned.includes(thread.key) || thread.serverIsPin ? '★' : '☆'}</button>
        </div>
      {/each}
      {#if inbox.data.hasNextPage}<button class="load" onclick={() => loadInbox(inbox.state === 'ready' ? inbox.data.cursor : undefined)}>Load more</button>{/if}
    {/if}
  </aside>
  <section class="main">
    {#if !selected}<p class="empty">Select a thread</p>
    {:else}
      <div class="top"><strong>{selected.title}</strong></div>
      {#if activeMessages?.state === 'loading-initial'}<p class="empty">Loading messages…</p>
      {:else if activeMessages?.state === 'error'}<p class="error">{activeMessages.error}</p>
      {:else if activeMessages?.data}
        <div class="messages">
          {#if activeMessages.hasNextPage}<button class="load" disabled={activeMessages.loadingOlder} onclick={loadOlder}>{activeMessages.loadingOlder ? 'Loading older…' : 'Load older'}</button>{/if}
          {#if activeMessages.error}<p class="error">{activeMessages.error}</p>{/if}
          {#each activeMessages.data.items as message, index (message.id)}
            <div class:mine={isMine(message, activeMessages.data.viewerId)} class="message-row">
              <div class="sender-avatar-slot">
                {#if showSenderAvatar(message, activeMessages.data.items[index + 1], activeMessages.data)}
                  <img class="sender-avatar" src={senderAvatar(message, activeMessages.data.thread) ?? ''} alt="" />
                {/if}
              </div>
              <div class="bubble">
                <div class="meta">{new Date(message.ts).toLocaleString()}</div>
                {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
                {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
                {:else if message.kind === 'reel_share'}<button class="reel" onclick={() => openReel(message.shortcode, message.mediaId)}><img class="avatar" src={message.thumbUrl} alt="" /> Open reel by {message.author}</button>
                {:else}<em>Unsupported: {message.contentType}</em>{/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
</main>

{#if reel.state !== 'idle'}
  <div class="modal" role="dialog" tabindex="-1" onclick={() => reel = { state: 'idle' }} onkeydown={(event) => event.key === 'Escape' && (reel = { state: 'idle' })}>
    <section class="modal-card">
      {#if reel.state === 'loading'}Loading reel…{:else if reel.state === 'error'}<p class="error">{reel.message}</p>{:else}<video controls autoplay muted src={reel.data.videoUrl}></video>{/if}
    </section>
  </div>
{/if}
