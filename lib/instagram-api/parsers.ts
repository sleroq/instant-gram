import type {
    Folder,
    Message,
    MessageActions,
    MessageFallback,
    MessageImage,
    MessageReaction,
    MessageRequestFolder,
    MutationSuccess,
    PinThreadResult,
    SetReactionResult,
    InstagramSecondaryGraphqlResult,
    Page,
    ReelComment,
    ReelComments,
    ReelLikeReceipt,
    ReelMedia,
    ReelMediaItem,
    ReelSaveReceipt,
    ReplyPreview,
    SentMessage,
    SentTextMessage,
    Thread,
    ThreadInfo,
    ThreadMessages,
    UnreadCount,
    User,
} from '../domain.ts';
import {
    parseThreadActivityMs,
    parseTimestampMs,
} from '../instagram-timestamps.ts';

type JsonObject = Record<string, unknown>;
type ReelPayload = { shortcode: string; mediaId?: string };

function objectProp(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

function stringProp(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanProp(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function numberProp(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function imageUrl(value: unknown): string | undefined {
    return stringProp(objectProp(value)?.url);
}

function textFragments(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;
    const text = value
        .map(fragment => stringProp(objectProp(fragment)?.plaintext) ?? '')
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

function xmaSubtitle(xma: JsonObject | undefined, content?: JsonObject): string | undefined {
    return (
        stringProp(xma?.subtitle_text) ??
        stringProp(xma?.caption_body_text) ??
        stringProp(content?.xma_text_body)
    );
}

function xmaThumb(xma: JsonObject | undefined): string | undefined {
    return imageUrl(xma?.preview_image) ?? imageUrl(xma?.xmaPreviewImage);
}

function positiveDimension(value: unknown): number | undefined {
    const dimension = numberProp(value);
    return dimension !== undefined && dimension > 0 ? dimension : undefined;
}

function xmaPreviewDimensions(xma: JsonObject): { width: number; height: number } | undefined {
    const image = objectProp(xma.preview_image) ?? objectProp(xma.xmaPreviewImage);
    const width = positiveDimension(image?.width);
    const height = positiveDimension(image?.height);
    return width !== undefined && height !== undefined ? { width, height } : undefined;
}

function messageId(node: JsonObject): string {
    return (
        stringProp(node.message_id) ??
        stringProp(node.item_id) ??
        stringProp(node.id) ??
        `${senderId(node)}:${messageTs(node)}:${stringProp(node.content_type) ?? 'UNKNOWN'}`
    );
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

function parseReactions(value: unknown): MessageReaction[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
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

function reelShortcode(url: string): string | undefined {
    return /\/reel\/([^/?#]+)/.exec(url)?.[1];
}

function reelMediaId(
    xma: JsonObject,
    targetUrl: string,
): string | undefined {
    const targetId = stringProp(xma.target_id);
    const normalizedTargetId = targetId && /^(\d+)(?:_\d+)?$/.exec(targetId)?.[1];
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
    return content.attachments.flatMap(value => {
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
    const fragmentText = textFragments(content?.text_fragments);
    const labels: Record<string, string> = {
        IMAGES: 'Photo',
        MESSAGE_INLINE_SHARE: 'Shared post',
        GEN_AI_RICH_RESPONSE_XMA: 'Meta AI response',
        GEN_AI_SEARCH_PLUGIN_RESPONSE_XMA: 'Meta AI search response',
        MONTAGE_SHARE_XMA: 'Story',
        IG_REELS_BLEND_VISITATION_XMAT: 'Reels blend activity',
    };
    return {
        label: xmaTitle(xma) ?? fragmentText ?? labels[contentType] ?? 'Unsupported message',
        preview:
            stringProp(node.text_body) ??
            stringProp(content?.text_body) ??
            stringProp(content?.messasge_text_body) ??
            stringProp(content?.xma_text_body) ??
            xmaSubtitle(xma, content),
        targetUrl:
            stringProp(xma?.target_url) ?? stringProp(xma?.targetUrl),
        thumbUrl: xmaThumb(xma),
    };
}

export function parseMessage(value: unknown): Message | undefined {
    const node = objectProp(value);
    if (!node) return undefined;
    const contentType = stringProp(node.content_type) ?? 'UNKNOWN';
    if (contentType === 'REACTION_LOG_XMAT') return undefined;

    const id = messageId(node);
    const ts = messageTs(node);
    const sender = senderId(node);
    const content = objectProp(node.content);
    const repliedToMessage = objectProp(node.replied_to_message);
    const repliedTo =
        stringProp(node.replied_to_message_id) ??
        stringProp(repliedToMessage?.message_id);
    const common = {
        id,
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
            id,
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

    const activityLabels: Record<string, string> = {
        CHANGE_THREAD_IMAGE_XMAT: 'Group image changed',
        CHANGE_THREAD_NAME_XMAT: 'Group name changed',
        REMOVE_PARTICIPANT_XMAT: 'Participant removed',
        THREAD_IGD_NEW_FRIEND_BUMP_XMAT: 'You are now connected on Instagram',
    };
    if (contentType in activityLabels)
        return {
            kind: 'activity',
            id,
            ts,
            reactions: common.reactions,
            isPinned: common.isPinned,
            text:
                stringProp(node.text_body) ??
                stringProp(content?.text_body) ??
                textFragments(content?.text_fragments) ??
                activityLabels[contentType],
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
        const shortcode = targetUrl ? reelShortcode(targetUrl) : undefined;
        if (targetUrl && shortcode && thumbUrl) {
            const previewDimensions = xmaPreviewDimensions(xma);
            return {
                ...common,
                kind: 'reel_share',
                shortcode,
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

export function parseUser(value: unknown): User | undefined {
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
        fullName:
            stringProp(user.full_name) ?? stringProp(user.fullName) ?? '',
        picUrl:
            stringProp(user.profile_pic_url) ??
            stringProp(user.profilePicUrl) ??
            stringProp(user.profile_pic_url_hd) ??
            null,
    };
}

export function parseFolder(value: unknown): Folder | undefined {
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
    for (const list of [thread.pinned_messages, thread.pinned_messages_metadata]) {
        if (!Array.isArray(list)) continue;
        for (const value of list) {
            const item = objectProp(value);
            const id = stringProp(item?.message_id) ?? stringProp(item?.id);
            if (id && !ids.includes(id)) ids.push(id);
        }
    }
    return ids;
}

export function parseThread(value: unknown): Thread | undefined {
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
    const lastMessage = (Array.isArray(slideMessages?.edges)
        ? slideMessages.edges
        : []
    )
        .map(edge => parseMessage(objectProp(edge)?.node))
        .find((message): message is Message => Boolean(message));
    const generatedTitle = users
        .map(user => user.username || user.fullName)
        .filter(Boolean)
        .join(', ');
    return {
        key,
        threadFbid:
            stringProp(thread.thread_fbid) ??
            stringProp(thread.thread_igid) ??
            stringProp(thread.id),
        threadIgId: stringProp(thread.thread_id),
        title:
            stringProp(thread.thread_title) ?? (generatedTitle || 'Untitled'),
        isGroup:
            booleanProp(thread.is_group) ??
            booleanProp(thread.is_group_thread) ??
            false,
        isMuted:
            booleanProp(thread.is_muted) ??
            booleanProp(thread.muted) ??
            false,
        folder:
            parseFolder(thread.messaging_folder_tag) ??
            parseFolder(thread.system_folder) ??
            parseFolder(thread.folder) ??
            'PRIMARY',
        lastActivityMs: parseThreadActivityMs(thread),
        serverIsPin: booleanProp(thread.is_pin) ?? false,
        serverPinnedMessageIds: pinnedMessageIds(thread),
        users,
        lastMessage,
        cursor: stringProp(thread.thread_fbid) ?? key,
    };
}

export function parseThreads(container: unknown): Page<Thread> {
    const box = objectProp(container);
    const pageInfo = objectProp(box?.page_info);
    const items = (Array.isArray(box?.edges) ? box.edges : [])
        .map(edge => {
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

export function parseMessagePage(container: unknown): Page<Message> {
    const page = objectProp(container);
    const pageInfo = objectProp(page?.page_info);
    const items = (Array.isArray(page?.edges) ? page.edges : [])
        .map(edge => parseMessage(objectProp(edge)?.node))
        .filter((message): message is Message => Boolean(message))
        .reverse();
    return {
        items,
        cursor: stringProp(pageInfo?.end_cursor),
        hasNextPage: booleanProp(pageInfo?.has_next_page) ?? false,
    };
}

function responseData(json: unknown): JsonObject | undefined {
    return objectProp(objectProp(json)?.data);
}

function responseThread(json: unknown): JsonObject | undefined {
    const data = responseData(json);
    const wrapper =
        objectProp(data?.get_slide_thread_nullable) ??
        objectProp(data?.fetch__SlideThread);
    return objectProp(wrapper?.as_ig_direct_thread);
}

export function parseInboxResponse(json: unknown): Page<Thread> {
    const data = responseData(json);
    const mailbox =
        objectProp(data?.get_slide_mailbox_for_iris_subscription) ??
        objectProp(data?.fetch__SlideMailbox);
    return parseThreads(mailbox?.threads_by_folder);
}

/** Interop messaging FBID required by Slide mailbox pagination. */
export function parseMailboxId(json: unknown): string | undefined {
    const data = responseData(json);
    const mailbox =
        objectProp(data?.get_slide_mailbox_for_iris_subscription) ??
        objectProp(data?.fetch__SlideMailbox);
    return stringProp(mailbox?.id);
}

export function parseMessageRequestsResponse(
    json: unknown,
    folder: MessageRequestFolder,
): Page<Thread> {
    const data = responseData(json);
    const mailbox =
        folder === 'SPAM'
            ? objectProp(data?.spamMailbox) ??
              objectProp(data?.fetch__SlideMailbox)
            : objectProp(data?.get_slide_mailbox_for_iris_subscription) ??
              objectProp(data?.fetch__SlideMailbox);
    const page = parseThreads(mailbox?.threads_by_folder);
    return {
        ...page,
        items: page.items.map(thread => ({ ...thread, folder: 'REQUESTS' })),
    };
}

export function parseThreadResponse(
    json: unknown,
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

export function parseThreadInfoResponse(json: unknown): ThreadInfo {
    const parsed = parseThread(responseThread(json));
    if (!parsed) throw new Error('Instagram thread info was not returned');
    const { key, threadFbid, threadIgId, title, isGroup, isMuted, serverIsPin, users } = parsed;
    return { key, threadFbid, threadIgId, title, isGroup, isMuted, serverIsPin, users };
}

export function parseThreadInfoResponses(
    headerJson: unknown,
    infoJson: unknown,
): ThreadInfo {
    const header = parseThread(responseThread(headerJson));
    const info = parseThread(responseThread(infoJson));
    if (!header && !info)
        throw new Error('Instagram thread info was not returned');
    const primary = header ?? info!;
    return {
        key: primary.key,
        threadFbid: header?.threadFbid ?? info?.threadFbid,
        threadIgId: header?.threadIgId ?? info?.threadIgId,
        title:
            header?.title && header.title !== 'Untitled'
                ? header.title
                : primary.title,
        isGroup: info?.isGroup ?? primary.isGroup,
        isMuted: info?.isMuted ?? primary.isMuted,
        serverIsPin: header?.serverIsPin ?? info?.serverIsPin ?? primary.serverIsPin,
        users: header?.users.length ? header.users : primary.users,
    };
}

function unreadPage(json: unknown, mailboxName = 'get_slide_mailbox_for_iris_subscription') {
    const data = responseData(json);
    const mailbox = objectProp(data?.[mailboxName]);
    const box = objectProp(mailbox?.threads_by_folder);
    const count = (Array.isArray(box?.edges) ? box.edges : []).filter(edge => {
        const node = objectProp(objectProp(edge)?.node);
        const thread = objectProp(node?.as_ig_direct_thread);
        return thread?.marked_as_unread === true;
    }).length;
    return {
        count,
        hasMore: booleanProp(objectProp(box?.page_info)?.has_next_page) ?? false,
    };
}

export function parseBadgeCountResponse(json: unknown): number {
    return unreadPage(json).count;
}

export function parseUnreadCountResponses(
    inboxJson: unknown,
    requestsJson?: unknown,
): UnreadCount {
    const inbox = unreadPage(inboxJson);
    const requests = unreadPage(requestsJson);
    const spam = unreadPage(requestsJson, 'spamMailbox');
    return {
        countedTotal: inbox.count + requests.count + spam.count,
        inbox,
        requests,
        spam,
    };
}

export function parseMessageActionsResponse(json: unknown): MessageActions {
    const data = responseData(json);
    const message = objectProp(data?.get_slide_message);
    const thread = objectProp(
        objectProp(data?.get_slide_thread_nullable)?.as_ig_direct_thread,
    );
    if (!message || !thread)
        throw new Error('Instagram message actions were not returned');
    const viewerId = stringProp(objectProp(thread.viewer)?.interop_messaging_user_fbid);
    const contentType = stringProp(message.content_type) ?? 'UNKNOWN';
    const pinnedIds = pinnedMessageIds(thread);
    const id = stringProp(message.message_id) ?? stringProp(message.id) ?? '';
    const isPinned =
        booleanProp(message.is_pinned) ?? (id !== '' && pinnedIds.includes(id));
    const reachable = thread.reachability_status === 'REACHABLE';
    const isActivity = contentType.endsWith('_XMAT') || contentType === 'ACTION_LOG';
    return {
        canCopy: contentType === 'TEXT',
        canReply: reachable && !isActivity,
        canReact: reachable && !isActivity,
        canUnsend:
            viewerId !== undefined && senderId(message) === viewerId,
        canPin: reachable && !isActivity,
        isPinned,
    };
}

function mutationSuccess(condition: boolean, message: string): MutationSuccess {
    if (!condition) throw new Error(message);
    return { success: true };
}

function parseMutationReactions(value: unknown): MessageReaction[] {
    if (!Array.isArray(value))
        throw new Error('Instagram reaction receipt was malformed');
    return value.map(value => {
        const reaction = objectProp(value);
        const senderId = stringProp(reaction?.sender_fbid);
        const emoji = stringProp(reaction?.reaction);
        const timestampMs = parseTimestampMs(reaction?.reaction_timestamp_ms);
        if (!senderId || !emoji || timestampMs === undefined)
            throw new Error('Instagram reaction receipt was malformed');
        return { senderId, reaction: emoji, timestampMs };
    });
}

export function parseReactionMutationResponse(json: unknown): SetReactionResult {
    const receipt = objectProp(
        responseData(json)?.xig_direct_reaction_send_with_slide_messaging_response,
    );
    const message = objectProp(receipt?.slide_message);
    const messageId = stringProp(message?.id);
    if (!message || !messageId)
        throw new Error('Instagram reaction receipt was not returned');
    return {
        messageId,
        reactions: parseMutationReactions(message.reactions),
    };
}

export function parseMarkThreadReadResponse(json: unknown): MutationSuccess {
    return mutationSuccess(
        objectProp(
            responseData(json)
                ?.xig_direct_item_seen_mutation_with_slide_messaging_response,
        ) !== undefined,
        'Instagram read receipt was not returned',
    );
}

export function parseMarkThreadReadValidationResponse(
    json: unknown,
): MutationSuccess {
    if (typeof responseData(json)?.xig_direct_mark_read_id_validation !== 'boolean')
        throw new Error('Instagram read validation was not returned');
    return { success: true };
}

function sentMessage(value: unknown, clientRequestId: string): SentMessage {
    const receipt = objectProp(value);
    const id = stringProp(receipt?.message_id) ?? stringProp(receipt?.id);
    if (!id) throw new Error('Instagram sent message ID was not returned');
    return {
        messageId: id,
        timestampMs: parseTimestampMs(receipt?.timestamp_ms),
        clientRequestId,
    };
}

export function parseSentTextResponse(json: unknown, clientRequestId: string): SentTextMessage {
    const receipt = objectProp(
        responseData(json)?.xig_direct_text_send_with_slide_messaging_response,
    );
    const messageId = stringProp(receipt?.message_id);
    if (!messageId)
        throw new Error('Instagram sent message ID was not returned');
    const timestampMs = parseTimestampMs(receipt?.timestamp_ms);
    if (timestampMs === undefined)
        throw new Error('Instagram sent message timestamp was not returned');
    return { messageId, timestampMs, clientRequestId };
}

export function parseSentCutoutStickerResponse(json: unknown, clientRequestId: string): SentMessage {
    return sentMessage(
        responseData(json)?.ig_direct_cutout_sticker_share_with_slide_msg_response,
        clientRequestId,
    );
}

function stickerImage(value: JsonObject | undefined) {
    const animated = objectProp(objectProp(value?.animated_info)?.webp);
    const still = objectProp(objectProp(value?.static_info)?.png);
    const image = animated ?? still;
    const url = stringProp(image?.url);
    const width = numberProp(image?.width);
    const height = numberProp(image?.height);
    return url && width !== undefined && height !== undefined
        ? { url, width, height, animated: Boolean(animated) }
        : undefined;
}

export function parseSecondaryGraphqlResponse(
    operation: InstagramSecondaryGraphqlResult['operation'],
    json: unknown,
): InstagramSecondaryGraphqlResult {
    const data = responseData(json);
    if (operation === 'IGDEmojiPickerQuery') {
        const nodes = objectProp(data?.emoji_categories)?.nodes;
        const categories = (Array.isArray(nodes) ? nodes : []).flatMap(value => {
            const category = objectProp(value);
            if (!category) return [];
            const id = stringProp(category?.id);
            const name = stringProp(category?.localized_name);
            if (!id || !name) return [];
            const items = (Array.isArray(category.emojis_in_category)
                ? category.emojis_in_category
                : []).flatMap(item => {
                const points = objectProp(item)?.codepoint;
                if (!Array.isArray(points) || !points.every(Number.isSafeInteger)) return [];
                try { return [String.fromCodePoint(...(points as number[]))]; }
                catch { return []; }
            });
            return [{ id, name, items }];
        });
        return { operation, categories };
    }
    if (
        operation === 'IGDComposerRichContentStickersV2Query' ||
        operation === 'IGDComposerRichContentStickersV2_recentStickersQuery' ||
        operation === 'IGDComposerRichContentStickersV2_cutoutStickersQuery'
    ) {
        const edges = objectProp(objectProp(data?.xig_igd_stickers_query)?.sections)?.edges;
        const sections = (Array.isArray(edges) ? edges : []).flatMap(edge => {
            const section = objectProp(objectProp(edge)?.node);
            if (!section) return [];
            const id = stringProp(section?.id);
            const title = stringProp(section?.title);
            if (!id || !title) return [];
            const stickerEdges = objectProp(section.stickers)?.edges;
            const items = (Array.isArray(stickerEdges) ? stickerEdges : []).flatMap(item => {
                const sticker = objectProp(objectProp(item)?.node);
                if (!sticker) return [];
                const stickerId = stringProp(sticker?.id);
                if (!stickerId) return [];
                return [{
                    id: stickerId,
                    altText: typeof sticker.alt_text === 'string' ? sticker.alt_text : '',
                    sendType: stringProp(sticker.sticker_send_type),
                    image: stickerImage(sticker),
                }];
            });
            return [{ id, title, type: stringProp(section.type), items }];
        });
        return { operation, sections };
    }
    if (
        operation === 'IGDComposerRichContentMusicQuery' ||
        operation === 'IGDComposerRichContentMusicSearchQuery' ||
        operation === 'playlistMusicRefetchQuery'
    ) {
        const playlist = objectProp(objectProp(data?.xfb_ig_audio_playlist_connection)?.items);
        const searchItems = objectProp(data?.xfb_ig_audio_search)?.items;
        const values = playlist && Array.isArray(playlist.edges)
            ? playlist.edges.map(edge => objectProp(edge)?.node)
            : Array.isArray(searchItems) ? searchItems : [];
        const tracks = values.flatMap(value => {
            const track = objectProp(objectProp(value)?.track ?? value);
            if (!track) return [];
            const id = stringProp(track?.id);
            const title = stringProp(track?.title);
            const artist = stringProp(track?.display_artist);
            const durationMs = numberProp(track?.duration_in_ms);
            return id && title && artist && durationMs !== undefined ? [{
                id,
                title,
                artist,
                durationMs,
                artworkUrl: stringProp(track.cover_artwork_uri),
                previewUrl: stringProp(track.web_30s_preview_download_url),
            }] : [];
        });
        const pageInfo = objectProp(playlist?.page_info);
        return {
            operation,
            tracks,
            cursor: stringProp(pageInfo?.end_cursor),
            hasNextPage: booleanProp(pageInfo?.has_next_page) ?? false,
        };
    }
    if (operation === 'IGDComposerRichContentTray_AvatarAvailableQuery') {
        return {
            operation,
            available: objectProp(objectProp(data?.fetch__IGUser)?.user_avatar) !== undefined,
        };
    }
    if (
        operation === 'IGDComposerRichContentStickersV2ThreadIGIDQuery' ||
        operation === 'IGDComposerRichContentMusicThreadIGIDQuery'
    ) {
        const wrapper = objectProp(data?.get_slide_thread_nullable);
        const thread = objectProp(wrapper?.as_ig_direct_thread);
        return {
            operation,
            threadFbid: stringProp(thread?.id) ?? stringProp(wrapper?.id),
        };
    }
    return { operation, payload: { data: data as Record<string, never> | undefined } };
}

export function parsePinnedMessageResponse(json: unknown): {
    pinnedMessageIds: string[];
} {
    const result = objectProp(responseData(json)?.xig_direct_pin_message);
    if (!result) throw new Error('Instagram pin result was not returned');
    return { pinnedMessageIds: pinnedMessageIds(result) };
}

export function parsePinnedThreadResponse(json: unknown): PinThreadResult {
    const result = objectProp(responseData(json)?.xig_direct_pin_thread);
    const threadFbid = stringProp(result?.id);
    const isPinned = booleanProp(result?.is_pin);
    if (!result || !threadFbid || !/^\d+$/.test(threadFbid) || isPinned === undefined)
        throw new Error('Instagram conversation pin receipt was not returned');
    return { threadFbid, isPinned };
}

function equivalentMediaId(left: string, right: string): boolean {
    const normalize = (value: string) => /^\d+$/.test(value)
        ? value
        : /^(\d+)_\d+$/.exec(value)?.[1];
    const leftId = normalize(left);
    return Boolean(leftId && leftId === normalize(right));
}

function instagramMediaId(node: JsonObject | undefined): string | undefined {
    const pk = stringProp(node?.pk);
    const id = stringProp(node?.id);
    if (pk && /^\d+$/.test(pk) && (!id || equivalentMediaId(pk, id))) return pk;
    if (id) {
        const normalized = /^(\d+)(?:_\d+)?$/.exec(id)?.[1];
        if (normalized && (!pk || equivalentMediaId(normalized, pk))) return normalized;
    }
    return undefined;
}

function candidateImage(node: JsonObject): { url: string; width?: number; height?: number } | undefined {
    const imageVersions = objectProp(node.image_versions2);
    const candidates = Array.isArray(imageVersions?.candidates)
        ? imageVersions.candidates.map(objectProp).filter((item): item is JsonObject => Boolean(item))
        : [];
    const best = candidates.sort((a, b) =>
        (numberProp(b.width) ?? 0) * (numberProp(b.height) ?? 0) -
        (numberProp(a.width) ?? 0) * (numberProp(a.height) ?? 0)
    )[0];
    const url = stringProp(best?.url) ?? stringProp(node.display_url) ?? stringProp(node.thumbnail_src);
    return url ? { url, width: numberProp(best?.width), height: numberProp(best?.height) } : undefined;
}

function reelItem(
    node: JsonObject,
    fallbackId: string,
    canDownload: boolean,
): ReelMediaItem | undefined {
    const image = candidateImage(node);
    const seenUrls = new Set<string>();
    const versions = (Array.isArray(node.video_versions) ? node.video_versions : [])
        .map(objectProp)
        .filter((version): version is JsonObject => Boolean(version))
        .filter(version => {
            const url = stringProp(version.url);
            if (!url || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
        })
        .sort((a, b) => {
            const pixels = (numberProp(b.width) ?? 0) * (numberProp(b.height) ?? 0) -
                (numberProp(a.width) ?? 0) * (numberProp(a.height) ?? 0);
            return pixels || (numberProp(b.bandwidth) ?? 0) - (numberProp(a.bandwidth) ?? 0);
        });
    const videoUrl = stringProp(versions[0]?.url) ?? stringProp(node.video_url);
    const id = stringProp(node.pk) ?? stringProp(node.id) ?? fallbackId;
    const dimensionPairs = [
        [node.original_width, node.original_height],
        [node.width, node.height],
        [versions[0]?.width, versions[0]?.height],
        [image?.width, image?.height],
    ] as const;
    const dimensions = dimensionPairs.map(([rawWidth, rawHeight]) => ({
        width: positiveDimension(rawWidth),
        height: positiveDimension(rawHeight),
    })).find(pair => pair.width !== undefined && pair.height !== undefined);
    if (!dimensions?.width || !dimensions.height) return undefined;
    const { width, height } = dimensions;
    if (videoUrl) return {
        id,
        kind: 'video',
        videoUrl,
        variants: versions.length ? versions.map(version => ({
            url: stringProp(version.url)!,
            type: numberProp(version.type),
            width: numberProp(version.width),
            height: numberProp(version.height),
            bandwidth: numberProp(version.bandwidth),
        })) : [{ url: videoUrl }],
        posterUrl: image?.url ?? videoUrl,
        width,
        height,
        durationSec: numberProp(node.video_duration) ?? 0,
        canDownload,
        downloadUrl: canDownload ? videoUrl : undefined,
    };
    if (image) return {
        id,
        kind: 'image',
        imageUrl: image.url,
        posterUrl: image.url,
        width,
        height,
        canDownload,
        downloadUrl: canDownload ? image.url : undefined,
    };
    return undefined;
}

function reelAuthor(value: unknown) {
    const user = objectProp(value);
    return {
        id: stringProp(user?.pk) ?? stringProp(user?.id) ?? '',
        username: stringProp(user?.username) ?? '',
        fullName: stringProp(user?.full_name) ?? '',
        picUrl: stringProp(user?.profile_pic_url) ?? null,
        isVerified: booleanProp(user?.is_verified) ?? false,
    };
}

export function parseReelInfoResponse(
    json: unknown,
    payload: ReelPayload,
): ReelMedia {
    const root = objectProp(json);
    const item = Array.isArray(root?.items) ? objectProp(root.items[0]) : undefined;
    const mediaId = instagramMediaId(item);
    const shortcode = stringProp(item?.code) ?? stringProp(item?.shortcode);
    if (!item || !mediaId || shortcode !== payload.shortcode ||
        (payload.mediaId && !equivalentMediaId(mediaId, payload.mediaId)))
        throw new Error('Instagram reel REST identity did not match the requested reel');
    const canDownload = booleanProp(item.is_third_party_downloads_eligible) ?? false;
    const isCarousel = numberProp(item.media_type) === 8 ||
        stringProp(item.product_type) === 'carousel_container';
    if (isCarousel && (!Array.isArray(item.carousel_media) || !item.carousel_media.length))
        throw new Error('Instagram reel carousel media was not returned');
    const children = isCarousel ? (item.carousel_media as unknown[]).map(child => {
        const parsed = objectProp(child);
        if (!parsed) throw new Error('Instagram reel carousel contained malformed media');
        return parsed;
    }) : [item];
    const items = children
        .map((child, index) => reelItem(child, `${mediaId}:${index}`, canDownload));
    if (!items.length || items.some(child => !child))
        throw new Error('Instagram reel carousel contained unavailable media');
    const caption = objectProp(item.caption);
    return {
        id: mediaId,
        shortcode: payload.shortcode,
        author: reelAuthor(item.user),
        caption: stringProp(caption?.text),
        takenAtMs: numberProp(item.taken_at) === undefined
            ? undefined
            : numberProp(item.taken_at)! * 1_000,
        items: items as ReelMediaItem[],
        likeCount: numberProp(item.like_count) ?? 0,
        commentCount: numberProp(item.comment_count) ?? 0,
        hasLiked: booleanProp(item.has_liked) ?? false,
        hasSaved: booleanProp(item.has_viewer_saved) ?? booleanProp(item.has_saved) ??
            false,
        canSave: booleanProp(item.can_viewer_save) ?? true,
        canDownload,
    };
}

export function parseReelCommentsResponse(json: unknown): ReelComments {
    const root = objectProp(json);
    if (!root || !Array.isArray(root.comments))
        throw new Error('Instagram reel comments were not returned');
    const items = root.comments.map(objectProp).filter((comment): comment is JsonObject => Boolean(comment)).map((comment): ReelComment | undefined => {
        const id = stringProp(comment.pk) ?? stringProp(comment.id);
        const text = stringProp(comment.text);
        if (!id || !text) return undefined;
        return {
            id,
            text,
            createdAtMs: (numberProp(comment.created_at) ?? 0) * 1_000,
            likeCount: numberProp(comment.comment_like_count) ?? 0,
            hasLiked: booleanProp(comment.has_liked_comment) ?? false,
            childCommentCount: numberProp(comment.child_comment_count) ?? 0,
            author: reelAuthor(comment.user),
        };
    }).filter((comment): comment is ReelComment => Boolean(comment));
    const cursor = stringProp(root.next_min_id);
    return {
        items,
        ...(cursor ? { cursor } : {}),
        // Captured continuation pages report has_more_comments=false while still
        // returning a usable next_min_id, so cursor presence is authoritative.
        hasNextPage: Boolean(cursor),
    };
}

export function parseReelLikeResponse(
    json: unknown,
    liked: boolean,
): ReelLikeReceipt {
    const result = objectProp(responseData(json)?.[liked ? 'xig_media_like' : 'xig_media_unlike']);
    const mediaId = stringProp(objectProp(result?.media)?.id)?.split('_')[0];
    if (!mediaId) throw new Error('Instagram reel like receipt was not returned');
    return { mediaId, hasLiked: liked };
}

export function parseReelSaveResponse(
    json: unknown,
    saved: boolean,
): ReelSaveReceipt {
    const result = objectProp(responseData(json)?.[saved ? 'xig_media_save' : 'xig_media_unsave']);
    const mediaId = stringProp(objectProp(result?.media)?.id)?.split('_')[0];
    if (!mediaId) throw new Error('Instagram reel save receipt was not returned');
    return { mediaId, hasSaved: saved };
}
