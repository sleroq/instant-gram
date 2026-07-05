<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { tick } from 'svelte';
  import type { Message, ReplyPreview, Thread, ThreadMessages } from '../../lib/domain';
  import type { View } from './types';

  type Entry =
    | { kind: 'day'; day: string; key: string }
    | { kind: 'message'; message: Message; index: number; prev?: Message; next?: Message; key: string };

  let {
    selected,
    data,
    onopenreel,
  }: {
    selected?: Thread;
    data?: View<ThreadMessages>;
    onopenreel: (shortcode: string, mediaId?: string) => void;
  } = $props();

  let messagesEl = $state<HTMLDivElement>();

  function senderId(message: Message | undefined): string | undefined {
    return message && 'senderId' in message && message.senderId.length > 0 ? message.senderId : undefined;
  }

  function isMine(message: Message, viewerId: string): boolean {
    return senderId(message) === viewerId;
  }

  function senderAvatar(message: Message, thread?: Thread): string {
    const id = senderId(message);
    return id ? thread?.users.find(user => user.id === id)?.picUrl ?? '' : '';
  }

  function senderName(message: Message, thread?: Thread): string {
    const id = senderId(message);
    if (!id) return 'Unknown';
    const user = thread?.users.find(user => user.id === id);
    return user?.fullName || user?.username || 'Unknown';
  }

  function showSenderName(message: Message, previous: Message | undefined, data: ThreadMessages): boolean {
    return Boolean(senderId(message) && senderId(message) !== data.viewerId && senderId(message) !== senderId(previous));
  }

  function showSenderAvatar(message: Message, next: Message | undefined, data: ThreadMessages): boolean {
    return Boolean(senderId(message) && senderId(message) !== data.viewerId && senderId(message) !== senderId(next));
  }

  function day(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function showDay(message: Message, previous: Message | undefined): boolean {
    return !previous || day(message.ts) !== day(previous.ts);
  }

  function time(message: Message): string {
    return new Date(message.ts).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' });
  }

  function preview(message: Message | undefined): ReplyPreview | undefined {
    if (!message) return undefined;
    if (message.kind === 'text') return { kind: 'text', text: message.text || 'Message' };
    if (message.kind === 'reel_share') return { kind: 'media', title: `Reel by ${message.author}`, thumbUrl: message.thumbUrl, subtitle: message.caption };
    if (message.kind === 'inline_share') return { kind: 'media', title: message.title, thumbUrl: message.thumbUrl, subtitle: message.subtitle };
    if (message.kind === 'reaction_log') return { kind: 'text', text: message.fragment };
    return { kind: 'unavailable', label: 'Original message unavailable' };
  }

  function replyFor(message: Message, items: Message[]): ReplyPreview | undefined {
    if (!('repliedTo' in message) || !message.repliedTo) return undefined;
    return message.replyPreview ?? preview(items.find(item => item.id === message.repliedTo));
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

  // Flatten messages into a single virtualized stream, interleaving day
  // separators so each row has one measurable height.
  const entries = $derived.by<Entry[]>(() => {
    if (data?.state !== 'ready') return [];
    const items = data.data.items;
    const out: Entry[] = [];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const prev = items[i - 1];
      if (showDay(m, prev)) {
        out.push({ kind: 'day', day: day(m.ts), key: `day-${day(m.ts)}` });
      }
      out.push({ kind: 'message', message: m, index: i, prev, next: items[i + 1], key: `msg-${m.id}` });
    }
    return out;
  });

  function estimateEntrySize(i: number): number {
    const entry = entries[i];
    if (!entry) return 64;
    return entry.kind === 'day' ? 36 : 64;
  }

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
    get count() {
      return entries.length;
    },
    getScrollElement: () => messagesEl ?? null,
    estimateSize: estimateEntrySize,
    overscan: 6,
    paddingStart: 16,
    paddingEnd: 16,
    anchorTo: 'end',
    scrollEndThreshold: 80,
    useAnimationFrameWithResizeObserver: true,
    getItemKey: (i) => entries[i]?.key ?? i,
  });

  // The svelte-virtual store adapter flattens getter options via spread on
  // setOptions, so reactive inputs must be pushed back in effects.
  $effect(() => {
    if (messagesEl) {
      get(virtualizer).setOptions({ getScrollElement: () => messagesEl ?? null });
    }
  });

  $effect(() => {
    const e = entries;
    get(virtualizer).setOptions({
      count: e.length,
      getItemKey: (i: number) => e[i]?.key ?? i,
    });
  });

  const virtualItems = $derived($virtualizer.getVirtualItems());
  const totalSize = $derived($virtualizer.getTotalSize());

  function measureItem(node: HTMLElement) {
    get(virtualizer).measureElement(node);
  }

  // Scroll to the latest message once data is ready. Wait for tick() so the
  // spacer div has its estimated height in the DOM before scrollToEnd reads
  // scrollHeight — otherwise the browser clamps scrollTop to 0. The
  // virtualizer's reconcile loop then refines as real measurements arrive.
  $effect(() => {
    const ready = data?.state === 'ready';
    const count = entries.length;
    if (!ready || count === 0) return;
    tick().then(() => get(virtualizer).scrollToEnd());
  });
</script>

<section class="main">
  {#if !selected}<p class="empty">Select a thread</p>
  {:else if data?.state === 'loading'}<p class="empty">Loading messages…</p>
  {:else if data?.state === 'error'}<p class="error">{data.message}</p>
  {:else if data?.state === 'ready'}
    <div class="top"><strong>{selected.title}</strong></div>
    <div class="messages" bind:this={messagesEl}>
      <div class="message-list-spacer" style="height: {totalSize}px;">
        {#each virtualItems as row (row.key)}
          {@const entry = entries[row.index]}
          {#if entry}
            <div class="virtual-message-row" data-index={row.index} style="transform: translateY({row.start}px);" use:measureItem>
              {#if entry.kind === 'day'}
                <div class="date-separator"><span>{entry.day}</span></div>
              {:else}
                {@const message = entry.message}
                {@const reply = replyFor(message, data.data.items)}
                <div class:mine={isMine(message, data.data.viewerId)} class="message-row" data-message-id={message.id}>
                  <div class="sender-avatar-slot">
                    {#if showSenderAvatar(message, entry.next, data.data)}
                      <img class="sender-avatar" src={senderAvatar(message, data.data.thread)} alt="" />
                    {/if}
                  </div>
                  <div class="bubble" title={time(message)} aria-label={`Sent ${time(message)}`}>
                    {#if showSenderName(message, entry.prev, data.data)}
                      <div class="sender-name">{senderName(message, data.data.thread)}</div>
                    {/if}
                    {#if reply}
                      <div class="reply-preview">
                        {#if replyThumb(reply)}<img class="reply-thumb" src={replyThumb(reply)} alt="" />{/if}
                        <span class="reply-text">{replyText(reply)}</span>
                      </div>
                    {/if}
                    {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
                    {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
                    {:else if message.kind === 'reel_share'}<button class="reel reel-card" onclick={() => onopenreel(message.shortcode, message.mediaId)}>{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>Open reel by {message.author}</span>{#if message.caption}<small>{message.caption}</small>{/if}</button>
                    {:else if message.kind === 'inline_share'}<a class="reel reel-card" href={message.targetUrl} target="_blank" rel="noreferrer">{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>{message.title}</span>{#if message.subtitle}<small>{message.subtitle}</small>{/if}</a>
                    {:else}<em>Unsupported: {message.contentType}</em>{/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {:else}
    <p class="empty">No messages</p>
  {/if}
</section>
