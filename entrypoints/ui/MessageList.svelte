<script lang="ts">
  import type { Message, ReplyPreview, Thread, ThreadMessages } from '../../lib/domain';
  import type { View } from './types';

  let {
    selected,
    data,
    messagesEl = $bindable(),
    onopenreel,
  }: {
    selected?: Thread;
    data?: View<ThreadMessages>;
    messagesEl?: HTMLDivElement;
    onopenreel: (shortcode: string, mediaId?: string) => void;
  } = $props();

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
</script>

<section class="main">
  {#if !selected}<p class="empty">Select a thread</p>
  {:else if data?.state === 'loading'}<p class="empty">Loading messages…</p>
  {:else if data?.state === 'error'}<p class="error">{data.message}</p>
  {:else if data?.state === 'ready'}
    <div class="top"><strong>{selected.title}</strong></div>
    <div class="messages" bind:this={messagesEl}>
      {#each data.data.items as message, index (message.id)}
        {#if showDay(message, data.data.items[index - 1])}
          <div class="date-separator"><span>{day(message.ts)}</span></div>
        {/if}
        <div class:mine={isMine(message, data.data.viewerId)} class="message-row" data-message-id={message.id}>
          <div class="sender-avatar-slot">
            {#if showSenderAvatar(message, data.data.items[index + 1], data.data)}
              <img class="sender-avatar" src={senderAvatar(message, data.data.thread)} alt="" />
            {/if}
          </div>
          <div class="bubble" title={time(message)} aria-label={`Sent ${time(message)}`}>
            {#if showSenderName(message, data.data.items[index - 1], data.data)}
              <div class="sender-name">{senderName(message, data.data.thread)}</div>
            {/if}
            {#if replyFor(message, data.data.items)}
              <div class="reply-preview">
                {#if replyThumb(replyFor(message, data.data.items))}<img class="reply-thumb" src={replyThumb(replyFor(message, data.data.items))} alt="" />{/if}
                <span class="reply-text">{replyText(replyFor(message, data.data.items))}</span>
              </div>
            {/if}
            {#if message.kind === 'text'}<span class="message-text">{message.text}</span>
            {:else if message.kind === 'reaction_log'}<span class="message-text">{message.fragment}</span>
            {:else if message.kind === 'reel_share'}<button class="reel reel-card" onclick={() => onopenreel(message.shortcode, message.mediaId)}>{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>Open reel by {message.author}</span>{#if message.caption}<small>{message.caption}</small>{/if}</button>
            {:else if message.kind === 'inline_share'}<a class="reel reel-card" href={message.targetUrl} target="_blank" rel="noreferrer">{#if message.thumbUrl}<img class="reel-banner" src={message.thumbUrl} alt="" />{/if}<span>{message.title}</span>{#if message.subtitle}<small>{message.subtitle}</small>{/if}</a>
            {:else}<em>Unsupported: {message.contentType}</em>{/if}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">No messages</p>
  {/if}
</section>