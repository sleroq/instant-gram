import type {
    Folder,
    Message,
    MessageFallback,
    MessageImage,
    MessageReaction,
    Page,
    ReplyPreview,
    Thread,
    ThreadMessages,
    User,
} from '../domain.ts';
import {
    parseThreadActivityMs,
    parseTimestampMs,
} from '../instagram-timestamps.ts';
import {
    isBoolean,
    isJsonObject,
    isNumber,
    isString,
    type JsonObject,
    type JsonValue,
} from '../json.ts';

function objectProp(value: JsonValue | undefined): JsonObject | undefined {
    return isJsonObject(value) ? value : undefined;
}

function stringProp(value: JsonValue | undefined): string | undefined {
    return isString(value) && value.length > 0 ? value : undefined;
}

function booleanProp(value: JsonValue | undefined): boolean | undefined {
    return isBoolean(value) ? value : undefined;
}

function numberProp(value: JsonValue | undefined): number | undefined {
    return isNumber(value) && Number.isFinite(value) ? value : undefined;
}

function imageUrl(value: JsonValue | undefined): string | undefined {
    return stringProp(objectProp(value)?.url);
}

function textFragments(value: JsonValue | undefined): string | undefined {
    if (!Array.isArray(value)) return undefined;
    const text = value
        .map((fragment) => stringProp(objectProp(fragment)?.plaintext) ?? '')
        .join('')
        .trim();
    return text || undefined;
}

function xmaTitle(xma: JsonObject | undefined): string | undefined {
    return (
        stringProp(xma?.header_title_text) ??
        stringProp(xma?.xmaHeaderTitle) ??
        stringProp(xma?.title_text) ??
        stringProp(xma?.xmaTitle) ??
        stringProp(xma?.caption_body_text) ??
        stringProp(xma?.eyebrow_text)
    );
}

function xmaSubtitle(
    xma: JsonObject | undefined,
    content?: JsonObject,
): string | undefined {
    return (
        stringProp(xma?.subtitle_text) ??
        stringProp(xma?.caption_body_text) ??
        stringProp(content?.xma_text_body)
    );
}

function xmaThumb(xma: JsonObject | undefined): string | undefined {
    return imageUrl(xma?.preview_image) ?? imageUrl(xma?.xmaPreviewImage);
}

function positiveDimension(value: JsonValue | undefined): number | undefined {
    const dimension = numberProp(value);
    return dimension !== undefined && dimension > 0 ? dimension : undefined;
}

function xmaPreviewDimensions(
    xma: JsonObject,
): { width: number; height: number } | undefined {
    const image =
        objectProp(xma.preview_image) ?? objectProp(xma.xmaPreviewImage);
    const width = positiveDimension(image?.width);
    const height = positiveDimension(image?.height);
    return width !== undefined && height !== undefined
        ? { width, height }
        : undefined;
}

function messageIdentity(node: JsonObject): {
    id: string;
    isSyntheticId?: true;
} {
    const id =
        stringProp(node.message_id) ??
        stringProp(node.item_id) ??
        stringProp(node.id);
    return id
        ? { id }
        : {
              id: `${senderId(node)}:${messageTs(node)}:${stringProp(node.content_type) ?? 'UNKNOWN'}`,
              isSyntheticId: true,
          };
}

function messageTs(node: JsonObject): number {
    for (const value of [node.timestamp_ms, node.timestamp]) {
        const timestamp = parseTimestampMs(value);
        if (timestamp !== undefined) return timestamp;
    }
    return 0;
}

function senderId(node: JsonObject): string {
    return (
        stringProp(node.sender_fbid) ??
        stringProp(node.sender_id) ??
        stringProp(node.user_id) ??
        ''
    );
}

function parseReactions(value: JsonValue | undefined): MessageReaction[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        const reaction = objectProp(item);
        const sender = stringProp(reaction?.sender_fbid);
        const emoji = stringProp(reaction?.reaction);
        if (!sender || !emoji) return [];
        const timestampMs = parseTimestampMs(reaction?.reaction_timestamp_ms);
        return [{ senderId: sender, reaction: emoji, timestampMs }];
    });
}

function replyPreview(value: JsonObject | undefined): ReplyPreview | undefined {
    if (!value) return undefined;
    const content = objectProp(value.content);
    const text =
        stringProp(value.text_body) ??
        stringProp(content?.text_body) ??
        stringProp(content?.text) ??
        textFragments(content?.text_fragments);
    if (text) return { kind: 'text', text };

    const attachment = Array.isArray(content?.attachments)
        ? objectProp(content.attachments[0])
        : undefined;
    if (attachment) {
        const thumbUrl =
            stringProp(attachment.preview_cdn_url) ??
            stringProp(attachment.attachment_cdn_url);
        return {
            kind: 'media',
            title: 'Image',
            thumbUrl,
        };
    }

    const xma = objectProp(content?.xma);
    if (xma) {
        const title = xmaTitle(xma) ?? stringProp(content?.xma_text_body);
        if (title)
            return {
                kind: 'media',
                title,
                subtitle: xmaSubtitle(xma, content),
                thumbUrl: xmaThumb(xma),
            };
    }

    if (stringProp(value.content_type) === 'IMAGES')
        return { kind: 'media', title: 'Photo' };

    return { kind: 'unavailable', label: 'Original message unavailable' };
}

function sharedMediaReference(
    url: string,
): { shortcode: string; mediaType: 'reel' | 'post' } | undefined {
    const match = /\/(reels?|p)\/([^/?#]+)/.exec(url);
    if (!match) return undefined;
    return {
        shortcode: match[2],
        mediaType: match[1] === 'p' ? 'post' : 'reel',
    };
}

function reelMediaId(xma: JsonObject, targetUrl: string): string | undefined {
    const targetId = stringProp(xma.target_id);
    const normalizedTargetId =
        targetId && /^(\d+)(?:_\d+)?$/.exec(targetId)?.[1];
    if (normalizedTargetId) return normalizedTargetId;
    try {
        const id = new URL(targetUrl).searchParams.get('id')?.split('_')[0];
        return id && /^\d+$/.test(id) ? id : undefined;
    } catch {
        return undefined;
    }
}

function parseImages(content: JsonObject | undefined): MessageImage[] {
    if (!Array.isArray(content?.attachments)) return [];
    return content.attachments.flatMap((value) => {
        const attachment = objectProp(value);
        const url =
            stringProp(attachment?.attachment_cdn_url) ??
            stringProp(attachment?.preview_cdn_url);
        if (!url) return [];
        return [
            {
                url,
                previewUrl: stringProp(attachment?.preview_cdn_url),
                width: numberProp(attachment?.preview_width),
                height: numberProp(attachment?.preview_height),
            },
        ];
    });
}

function fallbackFor(
    contentType: string,
    node: JsonObject,
    content: JsonObject | undefined,
): MessageFallback {
    const xma = objectProp(content?.xma);
    return {
        label:
            xmaTitle(xma) ??
            textFragments(content?.text_fragments) ??
            fallbackLabel(contentType),
        preview:
            stringProp(node.text_body) ??
            stringProp(content?.text_body) ??
            stringProp(content?.messasge_text_body) ??
            stringProp(content?.xma_text_body) ??
            xmaSubtitle(xma, content),
        targetUrl: stringProp(xma?.target_url) ?? stringProp(xma?.targetUrl),
        thumbUrl: xmaThumb(xma),
    };
}

function fallbackLabel(contentType: string): string {
    switch (contentType) {
        case 'IMAGES':
            return 'Photo';
        case 'MESSAGE_INLINE_SHARE':
            return 'Shared post';
        case 'GEN_AI_RICH_RESPONSE_XMA':
            return 'Meta AI response';
        case 'GEN_AI_SEARCH_PLUGIN_RESPONSE_XMA':
            return 'Meta AI search response';
        case 'MONTAGE_SHARE_XMA':
            return 'Story';
        case 'IG_REELS_BLEND_VISITATION_XMAT':
            return 'Reels blend activity';
        default:
            return 'Unsupported message';
    }
}

function activityLabel(contentType: string): string | undefined {
    switch (contentType) {
        case 'CHANGE_THREAD_IMAGE_XMAT':
            return 'Group image changed';
        case 'CHANGE_THREAD_NAME_XMAT':
            return 'Group name changed';
        case 'REMOVE_PARTICIPANT_XMAT':
            return 'Participant removed';
        case 'THREAD_IGD_NEW_FRIEND_BUMP_XMAT':
            return 'You are now connected on Instagram';
        default:
            return undefined;
    }
}

export function parseMessage(
    value: JsonValue | undefined,
): Message | undefined {
    const node = objectProp(value);
    if (!node) return undefined;
    const contentType = stringProp(node.content_type) ?? 'UNKNOWN';
    if (contentType === 'REACTION_LOG_XMAT') return undefined;

    const identity = messageIdentity(node);
    const ts = messageTs(node);
    const sender = senderId(node);
    const content = objectProp(node.content);
    const repliedToMessage = objectProp(node.replied_to_message);
    const repliedTo =
        stringProp(node.replied_to_message_id) ??
        stringProp(repliedToMessage?.message_id);
    const common = {
        ...identity,
        senderId: sender,
        ts,
        reactions: parseReactions(node.reactions),
        isPinned: booleanProp(node.is_pinned) ?? false,
        repliedTo,
        replyPreview: replyPreview(repliedToMessage),
    };

    if (contentType === 'TEXT')
        return {
            ...common,
            kind: 'text',
            text:
                stringProp(node.text_body) ??
                stringProp(content?.text_body) ??
                stringProp(content?.text) ??
                textFragments(content?.text_fragments) ??
                '',
        };

    if (contentType === 'ACTION_LOG' || contentType === 'REACTION_LOG')
        return {
            kind: 'reaction_log',
            ...identity,
            ts,
            reactions: common.reactions,
            isPinned: common.isPinned,
            fragment:
                stringProp(node.text_body) ??
                stringProp(content?.text_body) ??
                stringProp(content?.text) ??
                textFragments(content?.text_fragments) ??
                'Activity',
        };

    const activity = activityLabel(contentType);
    if (activity)
        return {
            kind: 'activity',
            ...identity,
            ts,
            reactions: common.reactions,
            isPinned: common.isPinned,
            text:
                stringProp(node.text_body) ??
                stringProp(content?.text_body) ??
                textFragments(content?.text_fragments) ??
                activity,
        };

    if (contentType === 'IMAGES') {
        const images = parseImages(content);
        if (images.length > 0) return { ...common, kind: 'image', images };
    }

    const xma = objectProp(content?.xma);
    if (contentType === 'MESSAGE_INLINE_SHARE' && xma) {
        const targetUrl =
            stringProp(xma.target_url) ?? stringProp(xma.targetUrl);
        const thumbUrl = xmaThumb(xma);
        const title = xmaTitle(xma) ?? 'Instagram share';
        const subtitle = xmaSubtitle(xma, content);
        const mediaReference = targetUrl
            ? sharedMediaReference(targetUrl)
            : undefined;
        if (targetUrl && mediaReference && thumbUrl) {
            const previewDimensions = xmaPreviewDimensions(xma);
            return {
                ...common,
                kind: 'reel_share',
                mediaType: mediaReference.mediaType,
                shortcode: mediaReference.shortcode,
                mediaId: reelMediaId(xma, targetUrl),
                targetUrl,
                thumbUrl,
                previewWidth: previewDimensions?.width,
                previewHeight: previewDimensions?.height,
                author: title,
                caption: subtitle,
            };
        }
        if (thumbUrl)
            return {
                ...common,
                kind: 'inline_share',
                targetUrl,
                thumbUrl,
                title,
                subtitle,
            };
    }

    return {
        ...common,
        kind: 'unsupported',
        contentType,
        fallback: fallbackFor(contentType, node, content),
    };
}

export function parseUser(value: JsonValue | undefined): User | undefined {
    const user = objectProp(value);
    if (!user) return undefined;
    const id =
        stringProp(user.interop_messaging_user_fbid) ??
        stringProp(user.fbid) ??
        stringProp(user.fbid_v2) ??
        stringProp(user.id) ??
        stringProp(user.pk);
    if (!id) return undefined;
    return {
        id,
        username: stringProp(user.username) ?? '',
        fullName: stringProp(user.full_name) ?? stringProp(user.fullName) ?? '',
        picUrl:
            stringProp(user.profile_pic_url) ??
            stringProp(user.profilePicUrl) ??
            stringProp(user.profile_pic_url_hd) ??
            null,
    };
}

export function parseFolder(value: JsonValue | undefined): Folder | undefined {
    switch (value) {
        case 'PRIMARY':
        case 'INBOX':
            return 'PRIMARY';
        case 'GENERAL':
            return 'GENERAL';
        case 'REQUESTS':
        case 'PENDING':
        case 'JUNK':
        case 'SPAM':
            return 'REQUESTS';
        default:
            return undefined;
    }
}

function pinnedMessageIds(thread: JsonObject): string[] {
    const ids: string[] = [];
    for (const list of [
        thread.pinned_messages,
        thread.pinned_messages_metadata,
    ]) {
        if (!Array.isArray(list)) continue;
        for (const value of list) {
            const item = objectProp(value);
            const id = stringProp(item?.message_id) ?? stringProp(item?.id);
            if (id && !ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

export function parseThread(value: JsonValue | undefined): Thread | undefined {
    const thread = objectProp(value);
    if (!thread) return undefined;
    const key =
        stringProp(thread.thread_key) ??
        stringProp(thread.thread_fbid) ??
        stringProp(thread.thread_igid) ??
        stringProp(thread.id);
    if (!key) return undefined;

    const users = (Array.isArray(thread.users) ? thread.users : [])
        .map(parseUser)
        .filter((user): user is User => Boolean(user));
    const slideMessages = objectProp(thread.slide_messages);
    let lastMessage: Message | undefined;
    for (const edge of Array.isArray(slideMessages?.edges)
        ? slideMessages.edges
        : []) {
        lastMessage = parseMessage(objectProp(edge)?.node);
        if (lastMessage) break;
    }

    const viewerFbid = stringProp(
        objectProp(thread.viewer)?.interop_messaging_user_fbid,
    );
    const viewerWatermark = (
        Array.isArray(thread.slide_read_receipts)
            ? thread.slide_read_receipts
            : []
    ).find(
        (value) =>
            stringProp(objectProp(value)?.participant_fbid) === viewerFbid,
    );
    const viewerWatermarkMs = parseTimestampMs(
        objectProp(viewerWatermark)?.watermark_timestamp_ms,
    );
    const hasUnreadIncoming = Boolean(
        viewerFbid &&
            viewerWatermarkMs !== undefined &&
            lastMessage &&
            'senderId' in lastMessage &&
            lastMessage.senderId !== viewerFbid &&
            lastMessage.ts > viewerWatermarkMs,
    );

    return {
        key,
        threadFbid:
            stringProp(thread.thread_fbid) ??
            stringProp(thread.thread_igid) ??
            stringProp(thread.id),
        threadIgId: stringProp(thread.thread_id),
        title:
            stringProp(thread.thread_title) ??
            (users
                .map((user) => user.username || user.fullName)
                .filter(Boolean)
                .join(', ') ||
                'Untitled'),
        isGroup:
            booleanProp(thread.is_group) ??
            booleanProp(thread.is_group_thread) ??
            false,
        isMuted:
            booleanProp(thread.is_muted) ?? booleanProp(thread.muted) ?? false,
        folder:
            parseFolder(thread.messaging_folder_tag) ??
            parseFolder(thread.system_folder) ??
            parseFolder(thread.folder) ??
            'PRIMARY',
        lastActivityMs: parseThreadActivityMs(thread),
        isUnread: thread.marked_as_unread === true || hasUnreadIncoming,
        serverIsPin: booleanProp(thread.is_pin) ?? false,
        serverPinnedMessageIds: pinnedMessageIds(thread),
        users,
        lastMessage,
        cursor: stringProp(thread.thread_fbid) ?? key,
    };
}

export function parseThreads(container: JsonValue | undefined): Page<Thread> {
    const box = objectProp(container);
    const pageInfo = objectProp(box?.page_info);
    const items = (Array.isArray(box?.edges) ? box.edges : [])
        .map((edge) => {
            const node = objectProp(objectProp(edge)?.node);
            return parseThread(node?.as_ig_direct_thread ?? node);
        })
        .filter((thread): thread is Thread => Boolean(thread));
    return {
        items,
        cursor: stringProp(pageInfo?.end_cursor),
        hasNextPage: booleanProp(pageInfo?.has_next_page) ?? false,
    };
}

export function parseMessagePage(
    container: JsonValue | undefined,
): Page<Message> {
    const page = objectProp(container);
    const pageInfo = objectProp(page?.page_info);
    const items = (Array.isArray(page?.edges) ? page.edges : [])
        .map((edge) => parseMessage(objectProp(edge)?.node))
        .filter((message): message is Message => Boolean(message))
        .reverse();
    return {
        items,
        cursor: stringProp(pageInfo?.end_cursor),
        hasNextPage: booleanProp(pageInfo?.has_next_page) ?? false,
    };
}

function responseData(json: JsonValue | undefined): JsonObject | undefined {
    return objectProp(objectProp(json)?.data);
}

function responseThread(json: JsonValue | undefined): JsonObject | undefined {
    const data = responseData(json);
    const wrapper =
        objectProp(data?.get_slide_thread_nullable) ??
        objectProp(data?.fetch__SlideThread);
    return objectProp(wrapper?.as_ig_direct_thread);
}

export function parseInboxResponse(json: JsonValue | undefined): Page<Thread> {
    const data = responseData(json);
    const mailbox =
        objectProp(data?.get_slide_mailbox_for_iris_subscription) ??
        objectProp(data?.fetch__SlideMailbox);
    return parseThreads(mailbox?.threads_by_folder);
}

/** Interop messaging FBID required by Slide mailbox pagination. */
export function parseMailboxId(
    json: JsonValue | undefined,
): string | undefined {
    const data = responseData(json);
    const mailbox =
        objectProp(data?.get_slide_mailbox_for_iris_subscription) ??
        objectProp(data?.fetch__SlideMailbox);
    return stringProp(mailbox?.id);
}

export function parseThreadResponse(
    json: JsonValue | undefined,
    fallbackViewerId: string,
): ThreadMessages {
    const thread = responseThread(json);
    const viewer = objectProp(thread?.viewer);
    return {
        ...parseMessagePage(thread?.slide_messages),
        thread: parseThread(thread),
        viewerId:
            stringProp(viewer?.interop_messaging_user_fbid) ??
            stringProp(thread?.viewer_id) ??
            fallbackViewerId,
    };
}
