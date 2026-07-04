<script lang="ts">
  import '../../lib/bridge';
  import { sendMessage } from 'webext-bridge/popup';
  import type { Message, Page, ReelMedia, Result, Thread, ThreadMessages } from '../../lib/domain';

  type JsonPayload = null | boolean | number | string | JsonPayload[] | { [key: string]: JsonPayload };

  type View<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

  let inbox = $state<View<Page<Thread>>>({ state: 'loading' });
  let selected = $state<Thread | undefined>();
  let messages = $state<View<ThreadMessages>>({ state: 'idle' });
  let pinned = $state<string[]>([]);
  let reel = $state<View<ReelMedia> & { shortcode?: string }>({ state: 'idle' });

  const sortedThreads = $derived(inbox.state === 'ready' ? [...inbox.data.items].sort((a, b) => {
    const ap = pinned.indexOf(a.key); const bp = pinned.indexOf(b.key);
    if (ap !== -1 || bp !== -1) return (ap === -1 ? 9999 : ap) - (bp === -1 ? 9999 : bp);
    if (a.serverIsPin !== b.serverIsPin) return a.serverIsPin ? -1 : 1;
    return b.lastActivityMs - a.lastActivityMs;
  }) : []);

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

  async function selectThread(thread: Thread) {
    selected = thread; messages = { state: 'loading' };
    try { messages = { state: 'ready', data: unwrap(await rpc<Result<ThreadMessages>>('getThread', { threadKey: thread.cursor ?? thread.key })) }; }
    catch (error) { messages = { state: 'error', message: error instanceof Error ? error.message : String(error) }; }
  }

  async function loadOlder() {
    if (!selected || messages.state !== 'ready' || !messages.data.cursor) return;
    const current = messages.data;
    messages = { state: 'loading' };
    try {
      const threadKey = selected.cursor ?? selected.key;
      const page = unwrap(await rpc<Result<ThreadMessages>>('getThread', current.cursor ? { threadKey, cursor: current.cursor } : { threadKey }));
      messages = { state: 'ready', data: { ...page, viewerId: current.viewerId, items: [...page.items, ...current.items] } };
    } catch (error) { messages = { state: 'error', message: error instanceof Error ? error.message : String(error) }; }
  }

  async function openReel(shortcode: string) {
    reel = { state: 'loading', shortcode };
    try { reel = { state: 'ready', shortcode, data: unwrap(await rpc<Result<ReelMedia>>('getReelMedia', { shortcode })) }; }
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
      {#if messages.state === 'loading'}<p class="empty">Loading messages…</p>
      {:else if messages.state === 'error'}<p class="error">{messages.message}</p>
      {:else if messages.state === 'ready'}
        <div class="messages">
          {#if messages.data.hasNextPage}<button class="load" onclick={loadOlder}>Load older</button>{/if}
          {#each messages.data.items as message, index (message.id)}
            <div class:mine={isMine(message, messages.data.viewerId)} class="message-row">
              <div class="sender-avatar-slot">
                {#if showSenderAvatar(message, messages.data.items[index + 1], messages.data)}
                  <img class="sender-avatar" src={senderAvatar(message, messages.data.thread) ?? ''} alt="" />
                {/if}
              </div>
              <div class="bubble">
                <div class="meta">{new Date(message.ts).toLocaleString()}</div>
                {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
                {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
                {:else if message.kind === 'reel_share'}<button class="reel" onclick={() => openReel(message.shortcode)}><img class="avatar" src={message.thumbUrl} alt="" /> Open reel by {message.author}</button>
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
