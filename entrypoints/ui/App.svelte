<script lang="ts">
  import '../../lib/bridge';
  import { sendMessage } from 'webext-bridge/popup';
  import type { Page, ReelMedia, Result, Thread, ThreadMessages } from '../../lib/domain';
  import MessageList from './MessageList.svelte';
  import ThreadList from './ThreadList.svelte';
  import type { View } from './types';

  type JsonPayload = null | boolean | number | string | JsonPayload[] | { [key: string]: JsonPayload };

  let inbox = $state<View<Page<Thread>>>({ state: 'loading' });
  let selected = $state<Thread | undefined>();
  let threads = $state<Record<string, View<ThreadMessages>>>({});
  let pinned = $state<string[]>([]);
  let reel = $state<View<ReelMedia> & { shortcode?: string }>({ state: 'idle' });

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
      inbox = cursor && inbox.state === 'ready'
        ? { state: 'ready', data: { ...page, items: [...inbox.data.items, ...page.items] } }
        : { state: 'ready', data: page };
    } catch (error) {
      inbox = { state: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async function loadPins() {
    pinned = (await rpc<{ pinned: string[] }>('getPins', null)).pinned;
  }

  async function togglePin(threadKey: string, event: MouseEvent) {
    event.stopPropagation();
    pinned = (await rpc<{ pinned: string[] }>('togglePin', { threadKey })).pinned;
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
        threads[key] = { state: 'ready', data: unwrap(await rpc<Result<ThreadMessages>>('getThread', { threadKey: thread.cursor ?? thread.key })) };
      } catch (error) {
        threads[key] = { state: 'error', message: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  async function openReel(shortcode: string, mediaId?: string) {
    reel = { state: 'loading', shortcode };
    try {
      reel = { state: 'ready', shortcode, data: unwrap(await rpc<Result<ReelMedia>>('getReelMedia', mediaId ? { shortcode, mediaId } : { shortcode })) };
    } catch (error) {
      reel = { state: 'error', shortcode, message: error instanceof Error ? error.message : String(error) };
    }
  }

  loadPins(); loadInbox();
</script>

<main class="app">
  <ThreadList {inbox} threads={sortedThreads} {selected} {pinned} onselect={selectThread} ontogglepin={togglePin} onloadmore={() => loadInbox(inbox.state === 'ready' ? inbox.data.cursor : undefined)} />
  {#key selected?.key}
    <MessageList {selected} data={selected ? threads[selected.key] : undefined} onopenreel={openReel} />
  {/key}
</main>

{#if reel.state !== 'idle'}
  <div class="modal" role="dialog" tabindex="-1" onclick={() => reel = { state: 'idle' }} onkeydown={(event) => event.key === 'Escape' && (reel = { state: 'idle' })}>
    <section class="modal-card">
      {#if reel.state === 'loading'}Loading reel…{:else if reel.state === 'error'}<p class="error">{reel.message}</p>{:else}<video controls autoplay muted src={reel.data.videoUrl}></video>{/if}
    </section>
  </div>
{/if}