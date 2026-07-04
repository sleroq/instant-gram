<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import type { Message, ReplyPreview, Thread, ThreadMessages } from '../../lib/domain';
  import type { MessageListApi, ThreadCacheEntry } from './types';

  const ESTIMATED_MESSAGE_HEIGHT = 92;
  const VIRTUAL_OVERSCAN = 8;

  let {
    selected,
    entry,
    messagesEl = $bindable(),
    api = $bindable(),
    highlightedMessageId,
    onscroll,
    onrangechange,
    onvisiblereplytargets,
    onreplyclick,
    onopenreel,
    onscrollbottom,
  }: {
    selected?: Thread;
    entry?: ThreadCacheEntry;
    messagesEl?: HTMLDivElement;
    api?: MessageListApi;
    highlightedMessageId?: string;
    onscroll: () => void;
    onrangechange: (startIndex: number) => void;
    onvisiblereplytargets: (messageIds: string[]) => void;
    onreplyclick: (messageId: string) => void;
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

  $effect(() => {
    api = {
      scrollToMessage: (messageId, behavior = 'smooth') => {
        const index = messages.findIndex(message => message.id === messageId);
        if (index === -1) return false;
        get(rowVirtualizer).scrollToIndex(index + (hasHistoryLoader ? 1 : 0), { align: 'center', behavior });
        return true;
      },
    };
  });

  $effect(() => {
    const targetIds = $rowVirtualizer.getVirtualItems()
      .map(virtualRow => virtualRow.index - (hasHistoryLoader ? 1 : 0))
      .filter(index => index >= 0)
      .map(index => messages[index])
      .filter((message): message is Message & { repliedTo: string } => Boolean(message && 'repliedTo' in message && message.repliedTo))
      .map(message => message.repliedTo);
    if (targetIds.length === 0) return;
    onvisiblereplytargets([...new Set(targetIds)]);
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

  function senderName(message: Message, thread?: Thread): string {
    const id = senderId(message);
    if (!id) return 'Unknown';
    const user = thread?.users.find(user => user.id === id);
    return user?.fullName || user?.username || 'Unknown';
  }

  function showSenderName(message: Message, previous: Message | undefined, data: ThreadMessages): boolean {
    const id = senderId(message);
    return Boolean(id && id !== data.viewerId && id !== senderId(previous));
  }

  function showSenderAvatar(message: Message, next: Message | undefined, data: ThreadMessages): boolean {
    const id = senderId(message);
    return Boolean(id && id !== data.viewerId && id !== senderId(next));
  }

  function messageDay(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function showDateSeparator(message: Message, previous: Message | undefined): boolean {
    return !previous || messageDay(message.ts) !== messageDay(previous.ts);
  }

  function exactTime(message: Message): string {
    return new Date(message.ts).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' });
  }

  function messagePreview(message: Message | undefined): ReplyPreview | undefined {
    if (!message) return undefined;
    if (message.kind === 'text') return { kind: 'text', text: message.text || 'Message' };
    if (message.kind === 'reel_share') return { kind: 'media', title: `Reel by ${message.author}`, thumbUrl: message.thumbUrl, subtitle: message.caption };
    if (message.kind === 'inline_share') return { kind: 'media', title: message.title, thumbUrl: message.thumbUrl, subtitle: message.subtitle };
    if (message.kind === 'reaction_log') return { kind: 'text', text: message.fragment };
    return { kind: 'unavailable', label: 'Original message unavailable' };
  }

  function replyFor(message: Message, items: Message[]): ReplyPreview | undefined {
    if (!('repliedTo' in message) || !message.repliedTo) return undefined;
    return message.replyPreview ?? messagePreview(items.find(item => item.id === message.repliedTo)) ?? { kind: 'unavailable', label: 'Original message unavailable' };
  }

  function replyThumb(reply: ReplyPreview | undefined): string | undefined {
    return reply?.kind === 'media' ? reply.thumbUrl : undefined;
  }

  function replyText(reply: ReplyPreview | undefined): string {
    if (!reply) return '';
    if (reply.kind === 'text') return reply.text;
    if (reply.kind === 'media') return reply.subtitle ? `${reply.title}: ${reply.subtitle}` : reply.title;
    return reply.label;
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
                    {#if showDateSeparator(message, entry.data.items[index - 1])}
                      <div class="date-separator"><span>{messageDay(message.ts)}</span></div>
                    {/if}
                    <div class:mine={isMine(message, entry.data.viewerId)} class:highlighted={message.id === highlightedMessageId} class="message-row" data-message-id={message.id}>
                      <div class="sender-avatar-slot">
                        {#if showSenderAvatar(message, entry.data.items[index + 1], entry.data)}
                          <img class="sender-avatar" src={senderAvatar(message, entry.data.thread) ?? ''} alt="" />
                        {/if}
                      </div>
                      <div class="bubble" title={exactTime(message)} aria-label={`Sent ${exactTime(message)}`}>
                        {#if showSenderName(message, entry.data.items[index - 1], entry.data)}
                          <div class="sender-name">{senderName(message, entry.data.thread)}</div>
                        {/if}
                        {#if replyFor(message, entry.data.items)}
                          <button class="reply-preview" type="button" onclick={() => 'repliedTo' in message && message.repliedTo && onreplyclick(message.repliedTo)}>
                            {#if replyThumb(replyFor(message, entry.data.items))}<img class="reply-thumb" src={replyThumb(replyFor(message, entry.data.items))} alt="" />{/if}
                            <span class="reply-text">{replyText(replyFor(message, entry.data.items))}</span>
                          </button>
                        {/if}
                        {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
                        {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
                        {:else if message.kind === 'reel_share'}<button class="reel reel-card" onclick={() => onopenreel(message.shortcode, message.mediaId)}>{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>Open reel by {message.author}</span>{#if message.caption}<small>{message.caption}</small>{/if}</button>
                        {:else if message.kind === 'inline_share'}<a class="reel reel-card" href={message.targetUrl} target="_blank" rel="noreferrer">{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>{message.title}</span>{#if message.subtitle}<small>{message.subtitle}</small>{/if}</a>
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
