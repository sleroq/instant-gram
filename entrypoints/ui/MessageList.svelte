<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { tick } from 'svelte';
  import type { Message, ReplyPreview, Thread, ThreadMessages } from '../../lib/domain';
  import type { View } from './types';

  type Entry =
    | { kind: 'history'; key: string }
    | { kind: 'day'; day: string; key: string }
    | { kind: 'message'; message: Message; index: number; prev?: Message; next?: Message; key: string };
  type MessageRenderEntry = Extract<Entry, { kind: 'day' | 'message' }>;

  const LOAD_EARLIER_THRESHOLD = 480;
  const EARLIER_BATCH_SIZE = 5;
  const FALLBACK_BATCH_RESERVED_HEIGHT = 3600;
  const MIN_BATCH_RESERVED_HEIGHT = 2400;
  const MAX_BATCH_RESERVED_HEIGHT = 8000;

  let {
    selected,
    data,
    onopenreel,
    onloadearlier,
  }: {
    selected?: Thread;
    data?: View<ThreadMessages>;
    onopenreel: (shortcode: string, mediaId?: string) => void;
    onloadearlier?: (beforeLoad: () => Promise<void>, limit: number) => Promise<ThreadMessages[]>;
  } = $props();

  let messagesEl = $state<HTMLDivElement>();
  let didInitialScroll = $state(false);
  let loadingEarlier = $state(false);
  let earlierError = $state<string>();
  let earlierBucketHeight = $state(0);
  let earlierContentHeight = $state(0);
  let earlierItems = $state<Message[]>([]);
  let earlierContentEl = $state<HTMLDivElement>();
  let lastBatchContentHeight = $state(0);
  let pendingBatchStartHeight: number | undefined;

  function messageEntries(items: Message[], nextMessage?: Message): MessageRenderEntry[] {
    const out: MessageRenderEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const prev = items[i - 1];
      if (showDay(m, prev)) {
        out.push({ kind: 'day', day: day(m.ts), key: `day-${day(m.ts)}-${m.id}` });
      }
      out.push({ kind: 'message', message: m, index: i, prev, next: items[i + 1] ?? nextMessage, key: `msg-${m.id}` });
    }
    return out;
  }

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

  function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  function historyWhitespaceBuffer(): number {
    return clamp(messagesEl?.clientHeight ?? 1200, 800, 1600);
  }

  function nextBatchReservation(): number {
    const estimate = lastBatchContentHeight > 0
      ? lastBatchContentHeight + historyWhitespaceBuffer()
      : FALLBACK_BATCH_RESERVED_HEIGHT;
    return Math.ceil(clamp(estimate, MIN_BATCH_RESERVED_HEIGHT, MAX_BATCH_RESERVED_HEIGHT));
  }

  async function setHistoryBucketHeight(height: number, preserveScroll: boolean) {
    const nextHeight = Math.max(0, Math.ceil(height));
    const previousHeight = earlierBucketHeight;
    const delta = nextHeight - previousHeight;
    if (delta === 0) return;

    const previousOffset = get(virtualizer).scrollOffset ?? 0;
    earlierBucketHeight = nextHeight;
    await tick();
    if (earlierBucketHeight > 0 && entries[0]?.kind === 'history') {
      get(virtualizer).resizeItem(0, earlierBucketHeight);
    }
    if (preserveScroll && previousHeight > 0) {
      get(virtualizer).scrollToOffset(Math.max(0, previousOffset + delta));
    }
  }

  function applyMeasuredEarlierContent(height: number) {
    if (height < 0) return;

    earlierContentHeight = height;
    if (pendingBatchStartHeight !== undefined) {
      const batchHeight = height - pendingBatchStartHeight;
      if (batchHeight <= 0) return;
      lastBatchContentHeight = batchHeight;
      pendingBatchStartHeight = undefined;
    }

    const maxWhitespace = data?.state === 'ready' && !data.data.hasNextPage ? 0 : historyWhitespaceBuffer();
    const desiredHeight = height + maxWhitespace;
    if (earlierBucketHeight > 0 && Math.abs(earlierBucketHeight - desiredHeight) > 1) {
      void setHistoryBucketHeight(desiredHeight, true);
    }
  }

  // Flatten messages into a single virtualized stream, interleaving day
  // separators so each row has one measurable height.
  const entries = $derived.by<Entry[]>(() => {
    if (data?.state !== 'ready') return [];
    const items = data.data.items;
    return [
      ...(earlierBucketHeight > 0 ? [{ kind: 'history' as const, key: 'history-bucket' }] : []),
      ...messageEntries(items),
    ];
  });

  function estimateEntrySize(i: number): number {
    const entry = entries[i];
    if (!entry) return 64;
    if (entry.kind === 'history') return earlierBucketHeight;
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
  const earlierEntries = $derived(data?.state === 'ready' ? messageEntries(earlierItems, data.data.items[0]) : []);

  function measureItem(node: HTMLElement, entry: Entry) {
    if (entry.kind === 'history') return;
    get(virtualizer).measureElement(node);
  }

  function measureEarlierContent(node: HTMLElement) {
    earlierContentEl = node as HTMLDivElement;
    let frame = 0;

    const measure = () => {
      applyMeasuredEarlierContent(node.offsetHeight);
    };

    tick().then(measure);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(node);

    return {
      update: measure,
      destroy() {
        cancelAnimationFrame(frame);
        if (earlierContentEl === node) earlierContentEl = undefined;
        observer.disconnect();
      },
    };
  }

  async function loadEarlierMessages() {
    if (!onloadearlier || loadingEarlier || data?.state !== 'ready' || !data.data.hasNextPage || !data.data.cursor) return;

    loadingEarlier = true;
    earlierError = undefined;
    const reserved = nextBatchReservation();
    const previousHeight = earlierBucketHeight;
    const shouldPreserveExistingBucket = previousHeight > 0;
    pendingBatchStartHeight = earlierContentHeight;
    await setHistoryBucketHeight(previousHeight + reserved, shouldPreserveExistingBucket);

    async function rollbackReservation() {
      pendingBatchStartHeight = undefined;
      await setHistoryBucketHeight(previousHeight, shouldPreserveExistingBucket);
    }

    try {
      const pages = await onloadearlier(async () => { await tick(); }, EARLIER_BATCH_SIZE);
      if (pages.length > 0) {
        const loadedIds = new Set([...earlierItems.map(message => message.id), ...data.data.items.map(message => message.id)]);
        const items: Message[] = [];
        for (const page of [...pages].reverse()) {
          for (const message of page.items) {
            if (loadedIds.has(message.id)) continue;
            loadedIds.add(message.id);
            items.push(message);
          }
        }
        if (items.length > 0) {
          earlierItems = [...items, ...earlierItems];
          await tick();
          if (earlierContentEl) applyMeasuredEarlierContent(earlierContentEl.offsetHeight);
        } else {
          await rollbackReservation();
        }
      } else {
        await rollbackReservation();
      }
    } catch (error) {
      await rollbackReservation();
      earlierError = error instanceof Error ? error.message : String(error);
    } finally {
      loadingEarlier = false;
    }
  }

  // Scroll to the latest message once data is ready. Wait for tick() so the
  // spacer div has its estimated height in the DOM before scrollToEnd reads
  // scrollHeight — otherwise the browser clamps scrollTop to 0. The
  // virtualizer's reconcile loop then refines as real measurements arrive.
  $effect(() => {
    const ready = data?.state === 'ready';
    const count = entries.length;
    if (!ready || count === 0 || didInitialScroll) return;
    tick().then(() => {
      get(virtualizer).scrollToEnd();
      didInitialScroll = true;
    });
  });

  $effect(() => {
    const offset = $virtualizer.scrollOffset ?? 0;
    const canLoadEarlier = didInitialScroll && data?.state === 'ready' && data.data.hasNextPage && data.data.cursor && !loadingEarlier && !earlierError && onloadearlier;
    const contentStart = earlierBucketHeight === 0 ? 0 : Math.max(0, earlierBucketHeight - earlierContentHeight);
    const canUseHistoryTrigger = earlierBucketHeight === 0 || earlierContentHeight > 0;
    if (canLoadEarlier && canUseHistoryTrigger && offset <= contentStart + LOAD_EARLIER_THRESHOLD) void loadEarlierMessages();
  });
</script>

<section class="main">
  {#if !selected}<p class="empty">Select a thread</p>
  {:else if data?.state === 'loading'}<p class="empty">Loading messages…</p>
  {:else if data?.state === 'error'}<p class="error">{data.message}</p>
  {:else if data?.state === 'ready'}
    <div class="top"><strong>{selected.title}</strong></div>
    {#if earlierError}<p class="error">Could not load earlier messages: {earlierError} <button onclick={() => { earlierError = undefined; void loadEarlierMessages(); }}>Retry</button></p>{/if}
    <div class="messages" bind:this={messagesEl}>
      <div class="message-list-spacer" style="height: {totalSize}px;">
        {#each virtualItems as row (row.key)}
          {@const entry = entries[row.index]}
          {#if entry}
            <div class="virtual-message-row" data-index={row.index} style="transform: translateY({row.start}px);" use:measureItem={entry}>
              {#if entry.kind === 'history'}
                <div class="earlier-page" style="height: {earlierBucketHeight}px;">
                    <div class="earlier-page-content" use:measureEarlierContent>
                      {#each earlierEntries as pageEntry (pageEntry.key)}
                        {#if pageEntry.kind === 'day'}
                          <div class="date-separator"><span>{pageEntry.day}</span></div>
                        {:else}
                          {@const message = pageEntry.message}
                          {@const reply = replyFor(message, [...earlierItems, ...data.data.items])}
                          <div class:mine={isMine(message, data.data.viewerId)} class="message-row" data-message-id={message.id}>
                            <div class="sender-avatar-slot">
                              {#if showSenderAvatar(message, pageEntry.next, data.data)}
                                <img class="sender-avatar" src={senderAvatar(message, data.data.thread)} alt="" />
                              {/if}
                            </div>
                            <div class="bubble" title={time(message)} aria-label={`Sent ${time(message)}`}>
                              {#if showSenderName(message, pageEntry.prev, data.data)}
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
                      {/each}
                    </div>
                </div>
              {:else if entry.kind === 'day'}
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
