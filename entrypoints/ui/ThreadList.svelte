<script lang="ts">
  import type { Message, Page, Thread } from '../../lib/domain';
  import type { View } from './types';

  let {
    inbox,
    threads,
    selected,
    pinned,
    onselect,
    ontogglepin,
    onloadmore,
  }: {
    inbox: View<Page<Thread>>;
    threads: Thread[];
    selected?: Thread;
    pinned: string[];
    onselect: (thread: Thread) => void;
    ontogglepin: (threadKey: string, event: MouseEvent) => void;
    onloadmore: () => void;
  } = $props();

  function snippet(message?: Message): string {
    if (!message) return '';
    switch (message.kind) {
      case 'text': return message.text;
      case 'reaction_log': return message.fragment;
      case 'reel_share': return `Reel from ${message.author}`;
      case 'inline_share': return message.title;
      case 'unsupported': return message.contentType;
    }
  }
</script>

<aside class="sidebar">
  {#if inbox.state === 'loading'}<p class="empty">Loading chats…</p>
  {:else if inbox.state === 'error'}
    <p class="error">{inbox.message}</p>
  {:else if inbox.state === 'ready'}
    {#each threads as thread (thread.key)}
      <div class:selected={selected?.key === thread.key} class="thread" role="button" tabindex="0" onclick={() => onselect(thread)} onkeydown={(event) => event.key === 'Enter' && onselect(thread)}>
        <img class="avatar" src={thread.users[0]?.picUrl ?? ''} alt="" />
        <span class="thread-text"><span class="title">{thread.title}</span><br /><span class="snippet">{snippet(thread.lastMessage)}</span></span>
        <button class="pin" title="Pin" onclick={(event) => ontogglepin(thread.key, event)}>{pinned.includes(thread.key) || thread.serverIsPin ? '★' : '☆'}</button>
      </div>
    {/each}
    {#if inbox.data.hasNextPage}<button class="load" onclick={onloadmore}>Load more</button>{/if}
  {/if}
</aside>
