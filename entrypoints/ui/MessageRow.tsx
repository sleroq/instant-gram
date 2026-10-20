import { For, Show } from 'solid-js';
import type { Message, User } from '../../lib/domain';

function validDate(ts: number) {
    const date = new Date(ts);
    return Number.isFinite(ts) && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
          }).format(date)
        : 'Time unavailable';
}

function initials(user: User | undefined, fallback: string) {
    const text = user?.fullName || user?.username || fallback;
    return text
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

function replyPreview(message: Message) {
    if (!('replyPreview' in message) || !message.replyPreview) return null;
    const reply = message.replyPreview;
    if (reply.kind === 'text') return reply.text;
    if (reply.kind === 'media') return reply.subtitle || reply.title;
    return reply.label;
}

function content(message: Message) {
    switch (message.kind) {
        case 'text':
            return <p>{message.text || 'Empty message'}</p>;
        case 'activity':
            return <p class="solid-message__activity">{message.text}</p>;
        case 'reaction_log':
            return <p class="solid-message__activity">{message.fragment}</p>;
        case 'image':
            return (
                <div class="solid-message__images" aria-label="Image message">
                    <For each={message.images}>
                        {(image) => (
                            <img
                                src={image.previewUrl || image.url}
                                alt="Shared image"
                                loading="lazy"
                                width={image.width}
                                height={image.height}
                            />
                        )}
                    </For>
                </div>
            );
        case 'reel_share':
            return (
                <a
                    class="solid-message__share"
                    href={message.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                >
                    <Show when={message.thumbUrl}>
                        <img src={message.thumbUrl} alt="" loading="lazy" />
                    </Show>
                    <span>
                        Shared a {message.mediaType}
                        <Show when={message.caption}> · {message.caption}</Show>
                    </span>
                </a>
            );
        case 'inline_share':
            return message.targetUrl ? (
                <a
                    class="solid-message__share"
                    href={message.targetUrl}
                    target="_blank"
                    rel="noreferrer"
                >
                    <Show when={message.thumbUrl}>
                        <img src={message.thumbUrl} alt="" loading="lazy" />
                    </Show>
                    <span>{message.title}</span>
                </a>
            ) : (
                <div class="solid-message__share">
                    <span>{message.title}</span>
                </div>
            );
        case 'unsupported':
            return (
                <div class="solid-message__unavailable" role="note">
                    <strong>{message.fallback.label}</strong>
                    <span>
                        {message.fallback.preview ||
                            'This content is unavailable.'}
                    </span>
                </div>
            );
    }
}

export function MessageRow(props: {
    message: Message;
    onReply(): void;
    onRetry(operationId: string): void;
    onRemove(operationId: string): void;
    user: User | undefined;
    outgoing: boolean;
    showSender: boolean;
}) {
    const reply = () => replyPreview(props.message);

    return (
        <article
            class={{
                'solid-message': true,
                'solid-message--outgoing': props.outgoing,
            }}
            data-message-id={props.message.id}
        >
            <Show when={props.showSender && !props.outgoing}>
                <span class="solid-message__avatar" aria-hidden="true">
                    <Show
                        when={props.user?.picUrl}
                        fallback={initials(props.user, 'Message')}
                    >
                        <img src={props.user?.picUrl || undefined} alt="" />
                    </Show>
                </span>
            </Show>
            <div class="solid-message__body">
                <Show when={reply()}>
                    <div
                        class="solid-message__reply"
                        aria-label="Reply preview"
                    >
                        {reply()}
                    </div>
                </Show>
                <div class="solid-message__content">
                    {content(props.message)}
                </div>
                <Show
                    when={
                        !props.message.isSyntheticId &&
                        (!props.message.delivery ||
                            props.message.delivery.status === 'succeeded')
                    }
                >
                    <button type="button" onClick={() => props.onReply()}>
                        Reply
                    </button>
                </Show>
                <Show
                    when={
                        props.message.delivery &&
                        props.message.delivery.status !== 'succeeded'
                            ? props.message.delivery
                            : undefined
                    }
                >
                    {(delivery) => (
                        <div role="status">
                            {delivery().status === 'outcome_unknown'
                                ? 'Delivery unknown — check conversation before sending again.'
                                : delivery().status}
                            <Show when={delivery().error}>
                                {delivery().error?.message}
                            </Show>
                            <Show
                                when={
                                    delivery().status === 'failed' &&
                                    delivery().retryable
                                }
                            >
                                <button
                                    type="button"
                                    onClick={() =>
                                        props.onRetry(delivery().operationId)
                                    }
                                >
                                    Retry send
                                </button>
                            </Show>
                            <Show
                                when={
                                    delivery().status === 'failed' ||
                                    delivery().status === 'outcome_unknown'
                                }
                            >
                                <button
                                    type="button"
                                    title="Remove this local status only; this does not unsend on Instagram."
                                    onClick={() =>
                                        props.onRemove(delivery().operationId)
                                    }
                                >
                                    Remove send
                                </button>
                            </Show>
                        </div>
                    )}
                </Show>
                <time
                    datetime={
                        Number.isFinite(props.message.ts) &&
                        !Number.isNaN(new Date(props.message.ts).getTime())
                            ? new Date(props.message.ts).toISOString()
                            : undefined
                    }
                >
                    {validDate(props.message.ts)}
                </time>
            </div>
        </article>
    );
}

export function dateLabel(ts: number) {
    const date = new Date(ts);
    return Number.isNaN(date.getTime())
        ? 'Date unavailable'
        : new Intl.DateTimeFormat(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
          }).format(date);
}
