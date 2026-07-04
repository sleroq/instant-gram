<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import type { Message, Thread, ThreadMessages } from '../../lib/domain';
  import type { ThreadCacheEntry } from './types';

  const ESTIMATED_MESSAGE_HEIGHT = 76;
  const VIRTUAL_OVERSCAN = 8;

  let {
    selected,
    entry,
    messagesEl = $bindable(),
    onscroll,
    onrangechange,
    onopenreel,
    onscrollbottom,
  }: {
    selected?: Thread;
    entry?: ThreadCacheEntry;
    messagesEl?: HTMLDivElement;
    onscroll: () => void;
    onrangechange: (startIndex: number) => void;
    onopenreel: (shortcode: string, mediaId?: string) => void;
    onscrollbottom: () => void;
  } = $props();

  const messages = $derived(entry?.data?.items ?? []);
  const hasHistoryLoader = $derived(Boolean(entry?.data && (entry.hasNextPage || entry.loadingOlder)));
  const virtualCount = $derived(messages.length + (hasHistoryLoader ? 1 : 0));

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    getScrollElement: () => messagesEl ?? null,
    getItemKey: index => {
      if (hasHistoryLoader && index === 0) return 'history-loader';
      return messages[index - (hasHistoryLoader ? 1 : 0)]?.id ?? index;
    },
    measureElement: element => element.getBoundingClientRect().height,
    overscan: VIRTUAL_OVERSCAN,
  });

  $effect(() => {
    get(rowVirtualizer).setOptions({
      count: virtualCount,
      getScrollElement: () => messagesEl ?? null,
    });
  });

  $effect(() => {
    const firstVirtualRow = $rowVirtualizer.getVirtualItems()[0];
    if (!firstVirtualRow) return;
    onrangechange(Math.max(0, firstVirtualRow.index - (hasHistoryLoader ? 1 : 0)));
  });

  function measureVirtualRow(node: HTMLDivElement) {
    get(rowVirtualizer).measureElement(node);
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
</script>

<section class="main">
  {#if !selected}<p class="empty">Select a thread</p>
  {:else}
    <div class="top"><strong>{selected.title}</strong></div>
    <div class="message-panel">
      <div class="messages" bind:this={messagesEl} onscroll={onscroll}>
        {#if entry?.state === 'loading-initial'}<p class="empty">Loading messages…</p>
        {:else if entry?.state === 'error'}<p class="error">{entry.error}</p>
        {:else if entry?.data}
          {#if entry.error}<p class="error">{entry.error}</p>{/if}
          <div class="message-list-spacer" style:height={`${$rowVirtualizer.getTotalSize()}px`}>
            {#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
              <div
                class="virtual-message-row"
                data-index={virtualRow.index}
                use:measureVirtualRow
                style:transform={`translateY(${virtualRow.start}px)`}
              >
                {#if hasHistoryLoader && virtualRow.index === 0}
                  <div class="history-loader" aria-live="polite">
                    {#if entry.loadingOlder && !entry.preloadingOlder}Loading older…{:else}Scroll up for older messages{/if}
                  </div>
                {:else}
                  {@const index = virtualRow.index - (hasHistoryLoader ? 1 : 0)}
                  {@const message = entry.data.items[index]}
                  {#if message}
                    <div class:mine={isMine(message, entry.data.viewerId)} class="message-row" data-message-id={message.id}>
                      <div class="sender-avatar-slot">
                        {#if showSenderAvatar(message, entry.data.items[index + 1], entry.data)}
                          <img class="sender-avatar" src={senderAvatar(message, entry.data.thread) ?? ''} alt="" />
                        {/if}
                      </div>
                      <div class="bubble">
                        <div class="meta">{new Date(message.ts).toLocaleString()}</div>
                        {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
                        {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
                        {:else if message.kind === 'reel_share'}<button class="reel" onclick={() => onopenreel(message.shortcode, message.mediaId)}><img class="avatar" src={message.thumbUrl} alt="" /> Open reel by {message.author}</button>
                        {:else if message.kind === 'inline_share'}<a class="reel" href={message.targetUrl} target="_blank" rel="noreferrer"><img class="avatar" src={message.thumbUrl} alt="" /> {message.title}{#if message.subtitle}: {message.subtitle}{/if}</a>
                        {:else}<em>Unsupported: {message.contentType}</em>{/if}
                      </div>
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
      {#if entry?.data && !entry.isAtBottom}
        <button class="jump-bottom" title="Jump to latest messages" aria-label="Jump to latest messages" onclick={onscrollbottom}>↓</button>
      {/if}
    </div>
  {/if}
</section>
