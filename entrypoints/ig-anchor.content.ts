import '../lib/bridge';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DOC_IDS, FRIENDLY_NAMES } from '../lib/config';
import { getErrorMessage } from '../lib/errors';
import {
    clearTokenCache,
    harvestTokens,
    startAuthProbeListener,
    type Tokens,
} from '../lib/ig-auth';
import type {
    Folder,
    Message,
    Page,
    ReelMedia,
    ReplyPreview,
    Result,
    RpcMap,
    Thread,
    ThreadMessages,
    User,
} from '../lib/domain';

type InboxPayload = Parameters<RpcMap['getInbox']>[0];
type ThreadPayload = Parameters<RpcMap['getThread']>[0];
type ReelPayload = Parameters<RpcMap['getReelMedia']>[0];

type GraphqlRequest = {
    friendlyName: string;
    docId: string;
    variables: Record<string, unknown>;
    endpoint?: string;
};

type InboxResponse = {
    data?: {
        get_slide_mailbox_for_iris_subscription?: {
            threads_by_folder?: unknown;
        };
        fetch__SlideMailbox?: {
            threads_by_folder?: unknown;
        };
    };
};

type ThreadResponse = {
    data?: {
        get_slide_thread_nullable?: {
            as_ig_direct_thread?: {
                slide_messages?: unknown;
                viewer_id?: unknown;
                viewer?: unknown;
            };
        };
        fetch__SlideThread?: {
            as_ig_direct_thread?: {
                slide_messages?: unknown;
                viewer_id?: unknown;
                viewer?: unknown;
            };
        };
    };
};

type ReelMediaResponse = {
    data?: {
        xdt_shortcode_media?: {
            id?: unknown;
            pk?: unknown;
            video_url?: unknown;
            video_duration?: unknown;
            owner?: {
                username?: unknown;
            };
        };
    };
};

type ReelInfoResponse = {
    items?: {
        pk?: unknown;
        code?: unknown;
        video_duration?: unknown;
        video_versions?: {
            url?: unknown;
            height?: unknown;
            bandwidth?: unknown;
        }[];
        user?: {
            username?: unknown;
        };
    }[];
};

async function graphql(
    friendlyName: string,
    docId: string,
    variables: Record<string, unknown>,
    endpoint = '/api/graphql',
    tokens?: Tokens,
): Promise<unknown> {
    const post = (auth: Tokens) => {
        const body = new URLSearchParams({
            __d: 'www',
            __a: '1',
            __comet_req: '7',
            dpr: '2',
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: friendlyName,
            server_timestamps: 'true',
            fb_dtsg: auth.fbDtsg,
            lsd: auth.lsd,
            jazoest: auth.jazoest,
            variables: JSON.stringify(variables),
            doc_id: docId,
        });
        return fetch(`https://www.instagram.com${endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '359341',
                'x-fb-lsd': auth.lsd,
                'x-fb-friendly-name': friendlyName,
                'x-csrftoken': auth.csrfToken,
            },
            body,
        });
    };
    tokens ??= await harvestTokens();
    let response = await post(tokens);
    if (response.status === 401 || response.status === 403) {
        clearTokenCache();
        tokens = await harvestTokens(true);
        response = await post(tokens);
    }
    if (!response.ok)
        throw new Error(
            `Instagram GraphQL ${friendlyName} failed with ${response.status}`,
        );
    return response.json() as Promise<unknown>;
}

function messageId(node: Record<string, unknown>): string {
    for (const value of [node.message_id, node.item_id, node.id]) {
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return crypto.randomUUID();
}
function messageTs(node: Record<string, unknown>): number {
    for (const value of [node.timestamp_ms, node.timestamp]) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && /^\d+$/.test(value))
            return Number(value);
    }
    return 0;
}
function senderId(node: Record<string, unknown>): string {
    return typeof node.sender_fbid === 'string' && node.sender_fbid.length > 0
        ? node.sender_fbid
        : typeof node.sender_id === 'string' && node.sender_id.length > 0
          ? node.sender_id
          : typeof node.user_id === 'string' && node.user_id.length > 0
            ? node.user_id
            : '';
}
function reelShortcode(url: string): string | undefined {
    return /\/reel\/([^/?#]+)/.exec(url)?.[1];
}

function reelMediaId(
    xma: Record<string, unknown>,
    targetUrl: string,
): string | undefined {
    if (typeof xma.target_id === 'string' && xma.target_id.length > 0)
        return xma.target_id;
    try {
        const id = new URL(targetUrl).searchParams.get('id')?.split('_')[0];
        return id && /^\d+$/.test(id) ? id : undefined;
    } catch {
        return undefined;
    }
}

function stringProp(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function imageUrl(value: unknown): string {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return '';
    const url = (value as Record<string, unknown>).url;
    return typeof url === 'string' && url.length > 0 ? url : '';
}

function textFragments(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;
    const text = value
        .map(fragment =>
            typeof fragment === 'object' &&
            fragment !== null &&
            !Array.isArray(fragment) &&
            typeof (fragment as Record<string, unknown>).plaintext === 'string'
                ? ((fragment as Record<string, unknown>).plaintext as string)
                : '',
        )
        .join('')
        .trim();
    return text.length > 0 ? text : undefined;
}

function objectProp(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function replyPreview(
    value: Record<string, unknown> | undefined,
): ReplyPreview | undefined {
    if (!value) return undefined;
    const content = objectProp(value.content);
    const text =
        stringProp(value.text_body) ??
        stringProp(content?.text) ??
        textFragments(content?.text_fragments);
    if (text) return { kind: 'text', text };

    const xma = objectProp(content?.xma);
    if (xma) {
        const title =
            stringProp(xma.header_title_text) ??
            stringProp(xma.title_text) ??
            stringProp(content?.xma_text_body);
        if (title)
            return {
                kind: 'media',
                title,
                subtitle: stringProp(xma.caption_body_text),
                thumbUrl: imageUrl(xma.preview_image) || undefined,
            };
    }

    return { kind: 'unavailable', label: 'Original message unavailable' };
}

function parseMessage(value: unknown): Message | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const node = value as Record<string, unknown>;
    const id = messageId(node);
    const ts = messageTs(node);
    const sender = senderId(node);
    const contentType =
        typeof node.content_type === 'string' && node.content_type.length > 0
            ? node.content_type
            : 'UNKNOWN';
    const content = objectProp(node.content);
    const contentText = content?.text;
    const textBody = node.text_body;
    const repliedToMessage = objectProp(node.replied_to_message);
    const repliedToMessageId = repliedToMessage?.message_id;
    const reply = replyPreview(repliedToMessage);
    if (contentType === 'REACTION_LOG_XMAT')
        // Instagram emits this as a separate "Liked a message" history row; actual
        // reaction state lives on the target message's `reactions` field.
        return undefined;
    if (contentType === 'TEXT')
        return {
            kind: 'text',
            id,
            senderId: sender,
            ts,
            text:
                typeof textBody === 'string' && textBody.length > 0
                    ? textBody
                    : typeof contentText === 'string' && contentText.length > 0
                      ? contentText
                      : '',
            repliedTo:
                typeof repliedToMessageId === 'string' &&
                repliedToMessageId.length > 0
                    ? repliedToMessageId
                    : undefined,
            replyPreview: reply,
        };
    if (contentType === 'ACTION_LOG' || contentType === 'REACTION_LOG')
        return {
            kind: 'reaction_log',
            id,
            ts,
            fragment:
                typeof textBody === 'string' && textBody.length > 0
                    ? textBody
                    : typeof contentText === 'string' && contentText.length > 0
                      ? contentText
                      : (textFragments(content?.text_fragments) ?? 'Activity'),
        };
    const xma =
        typeof content?.xma === 'object' &&
        content.xma !== null &&
        !Array.isArray(content.xma)
            ? (content.xma as Record<string, unknown>)
            : undefined;
    const targetUrl =
        typeof xma?.target_url === 'string' && xma.target_url.length > 0
            ? xma.target_url
            : undefined;
    const shortcode = targetUrl ? reelShortcode(targetUrl) : undefined;
    if (contentType === 'MESSAGE_INLINE_SHARE' && xma) {
        const thumbUrl = imageUrl(xma.preview_image);
        const title = stringProp(xma.header_title_text) ?? 'Instagram share';
        const subtitle =
            stringProp(xma.title_text) ??
            stringProp(xma.caption_body_text) ??
            stringProp(content?.xma_text_body);
        if (targetUrl && shortcode)
            return {
                kind: 'reel_share',
                id,
                senderId: sender,
                ts,
                shortcode,
                mediaId: reelMediaId(xma, targetUrl),
                targetUrl,
                thumbUrl,
                author: title,
                caption: subtitle,
                repliedTo:
                    typeof repliedToMessageId === 'string' &&
                    repliedToMessageId.length > 0
                        ? repliedToMessageId
                        : undefined,
                replyPreview: reply,
            };
        return {
            kind: 'inline_share',
            id,
            senderId: sender,
            ts,
            targetUrl,
            thumbUrl,
            title,
            subtitle:
                subtitle ??
                (stringProp(xma.__typename) === 'SlideMessagePlaceholderXMA'
                    ? 'Unavailable attachment'
                    : undefined),
            repliedTo:
                typeof repliedToMessageId === 'string' &&
                repliedToMessageId.length > 0
                    ? repliedToMessageId
                    : undefined,
            replyPreview: reply,
        };
    }
    return {
        kind: 'unsupported',
        id,
        senderId: sender,
        ts,
        contentType,
        repliedTo:
            typeof repliedToMessageId === 'string' &&
            repliedToMessageId.length > 0
                ? repliedToMessageId
                : undefined,
        replyPreview: reply,
    };
}

function parseUser(value: unknown): User | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const user = value as Record<string, unknown>;
    const id =
        typeof user.interop_messaging_user_fbid === 'string' &&
        user.interop_messaging_user_fbid.length > 0
            ? user.interop_messaging_user_fbid
            : typeof user.fbid === 'string' && user.fbid.length > 0
              ? user.fbid
              : typeof user.fbid_v2 === 'string' && user.fbid_v2.length > 0
                ? user.fbid_v2
                : typeof user.id === 'string' && user.id.length > 0
                  ? user.id
                  : typeof user.pk === 'string' && user.pk.length > 0
                    ? user.pk
                    : undefined;
    if (!id) return undefined;
    return {
        id,
        username:
            typeof user.username === 'string' && user.username.length > 0
                ? user.username
                : '',
        fullName:
            typeof user.full_name === 'string' && user.full_name.length > 0
                ? user.full_name
                : typeof user.name === 'string' && user.name.length > 0
                  ? user.name
                  : '',
        picUrl:
            typeof user.profile_pic_url === 'string' &&
            user.profile_pic_url.length > 0
                ? user.profile_pic_url
                : typeof user.profile_pic_url_hd === 'string' &&
                    user.profile_pic_url_hd.length > 0
                  ? user.profile_pic_url_hd
                  : null,
    };
}

function parseThread(value: unknown): Thread | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const thread = value as Record<string, unknown>;
    const key =
        typeof thread.thread_key === 'string' && thread.thread_key.length > 0
            ? thread.thread_key
            : typeof thread.thread_fbid === 'string' &&
                thread.thread_fbid.length > 0
              ? thread.thread_fbid
              : typeof thread.id === 'string' && thread.id.length > 0
                ? thread.id
                : undefined;
    if (!key) return undefined;
    const users = (Array.isArray(thread.users) ? thread.users : [])
        .map(parseUser)
        .filter((user): user is User => Boolean(user));
    const slideMessages =
        typeof thread.slide_messages === 'object' &&
        thread.slide_messages !== null &&
        !Array.isArray(thread.slide_messages)
            ? (thread.slide_messages as Record<string, unknown>)
            : undefined;
    const lastMessage = (
        Array.isArray(slideMessages?.edges) ? slideMessages.edges : []
    )
        .map(edge =>
            parseMessage(
                typeof edge === 'object' &&
                    edge !== null &&
                    !Array.isArray(edge)
                    ? (edge as Record<string, unknown>).node
                    : undefined,
            ),
        )
        .find(Boolean);
    const generatedTitle = users
        .map(u => u.username || u.fullName)
        .filter(Boolean)
        .join(', ');
    return {
        key,
        title:
            typeof thread.thread_title === 'string' &&
            thread.thread_title.length > 0
                ? thread.thread_title
                : generatedTitle || 'Untitled',
        isGroup: Boolean(thread.is_group_thread),
        isMuted: Boolean(thread.muted),
        folder:
            typeof thread.folder === 'string' && thread.folder.length > 0
                ? (thread.folder as Folder)
                : 'PRIMARY',
        lastActivityMs:
            typeof thread.last_activity_at_ms === 'number'
                ? thread.last_activity_at_ms
                : typeof thread.last_activity_ms === 'number'
                  ? thread.last_activity_ms
                  : 0,
        serverIsPin: Boolean(thread.is_pin),
        users,
        lastMessage,
        cursor:
            typeof thread.thread_fbid === 'string' &&
            thread.thread_fbid.length > 0
                ? thread.thread_fbid
                : key,
    };
}

function parseThreads(container: unknown): Page<Thread> {
    const containerObj =
        typeof container === 'object' &&
        container !== null &&
        !Array.isArray(container)
            ? (container as Record<string, unknown>)
            : undefined;
    const pageInfo =
        typeof containerObj?.page_info === 'object' &&
        containerObj.page_info !== null &&
        !Array.isArray(containerObj.page_info)
            ? (containerObj.page_info as Record<string, unknown>)
            : {};
    const items = (Array.isArray(containerObj?.edges) ? containerObj.edges : [])
        .map(edge =>
            parseThread(
                typeof edge === 'object' &&
                    edge !== null &&
                    !Array.isArray(edge) &&
                    typeof (edge as Record<string, unknown>).node ===
                        'object' &&
                    (edge as Record<string, unknown>).node !== null &&
                    !Array.isArray((edge as Record<string, unknown>).node)
                    ? (
                          (edge as Record<string, unknown>).node as Record<
                              string,
                              unknown
                          >
                      ).as_ig_direct_thread
                    : undefined,
            ),
        )
        .filter((thread): thread is Thread => Boolean(thread));
    return {
        items,
        cursor:
            typeof pageInfo.end_cursor === 'string' &&
            pageInfo.end_cursor.length > 0
                ? pageInfo.end_cursor
                : undefined,
        hasNextPage: Boolean(pageInfo.has_next_page),
    };
}

function parseMessagePage(container: unknown): Page<Message> {
    const containerObj =
        typeof container === 'object' &&
        container !== null &&
        !Array.isArray(container)
            ? (container as Record<string, unknown>)
            : undefined;
    const pageInfo =
        typeof containerObj?.page_info === 'object' &&
        containerObj.page_info !== null &&
        !Array.isArray(containerObj.page_info)
            ? (containerObj.page_info as Record<string, unknown>)
            : {};
    const items = (Array.isArray(containerObj?.edges) ? containerObj.edges : [])
        .map(edge =>
            parseMessage(
                typeof edge === 'object' &&
                    edge !== null &&
                    !Array.isArray(edge)
                    ? (edge as Record<string, unknown>).node
                    : undefined,
            ),
        )
        .filter((message): message is Message => Boolean(message))
        .reverse();
    return {
        items,
        cursor:
            typeof pageInfo.end_cursor === 'string' &&
            pageInfo.end_cursor.length > 0
                ? pageInfo.end_cursor
                : undefined,
        hasNextPage: Boolean(pageInfo.has_next_page),
    };
}

function ok<T>(value: T): Result<T> {
    return { ok: true, value };
}
function fail(error: unknown): Result<never> {
    return {
        ok: false,
        error: {
            message: getErrorMessage(error),
        },
    };
}

function inboxRequest(payload: InboxPayload, tokens: Tokens): GraphqlRequest {
    if (payload.cursor)
        return {
            friendlyName: FRIENDLY_NAMES.inboxPage,
            docId: DOC_IDS.inboxPage,
            variables: {
                count: 5,
                cursor: payload.cursor,
                folder: 'INBOX',
                newer_than_timestamp_ms: null,
                id: tokens.viewerId,
                __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
                __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
                __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
                __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
            },
        };
    return {
        friendlyName: FRIENDLY_NAMES.inbox,
        docId: DOC_IDS.inbox,
        variables: {
            device_id_for_iris_subscription: tokens.deviceId,
            __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
            __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
            __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
            __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
            __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
        },
    };
}

function threadRequest(payload: ThreadPayload): GraphqlRequest {
    if (payload.cursor)
        return {
            friendlyName: FRIENDLY_NAMES.olderMessages,
            docId: DOC_IDS.olderMessages,
            variables: {
                after: payload.cursor,
                before: null,
                first: 20,
                last: null,
                newer_than_message_id: null,
                older_than_message_id: null,
                id: payload.threadKey,
                __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
            },
        };
    return {
        friendlyName: FRIENDLY_NAMES.thread,
        docId: DOC_IDS.thread,
        variables: {
            thread_fbid: payload.threadKey,
            __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false,
            __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
            __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
        },
    };
}

function reelMediaRequest(payload: ReelPayload): GraphqlRequest {
    return {
        friendlyName: FRIENDLY_NAMES.reelMedia,
        docId: DOC_IDS.reelMedia,
        endpoint: '/graphql/query',
        variables: {
            shortcode: payload.shortcode,
            fetch_tagged_user_count: null,
            hoisted_comment_id: null,
            hoisted_reply_id: null,
        },
    };
}

async function fetchReelInfo(mediaId: string): Promise<unknown> {
    const response = await fetch(
        `https://www.instagram.com/api/v1/media/${mediaId}/info/`,
        {
            credentials: 'include',
            headers: {
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '359341',
            },
        },
    );
    if (!response.ok)
        throw new Error(`Instagram reel info failed with ${response.status}`);
    return response.json() as Promise<unknown>;
}

async function sendGraphqlRequest(
    request: GraphqlRequest,
    tokens?: Tokens,
): Promise<unknown> {
    return graphql(
        request.friendlyName,
        request.docId,
        request.variables,
        request.endpoint,
        tokens,
    );
}

function parseInboxResponse(json: unknown): Page<Thread> {
    const root = (json as InboxResponse).data;
    const box =
        root?.get_slide_mailbox_for_iris_subscription?.threads_by_folder ??
        root?.fetch__SlideMailbox?.threads_by_folder;
    return parseThreads(box);
}

function parseThreadResponse(json: unknown, viewerId: string): ThreadMessages {
    const root = (json as ThreadResponse).data;
    const thread =
        root?.get_slide_thread_nullable?.as_ig_direct_thread ??
        root?.fetch__SlideThread?.as_ig_direct_thread;
    const threadViewerId = thread?.viewer_id;
    const viewer =
        typeof thread?.viewer === 'object' &&
        thread.viewer !== null &&
        !Array.isArray(thread.viewer)
            ? (thread.viewer as Record<string, unknown>)
            : undefined;
    const viewerSenderId = viewer?.interop_messaging_user_fbid;
    return {
        ...parseMessagePage(thread?.slide_messages),
        thread: parseThread(thread),
        viewerId:
            typeof viewerSenderId === 'string' && viewerSenderId.length > 0
                ? viewerSenderId
                : typeof threadViewerId === 'string' &&
                    threadViewerId.length > 0
                  ? threadViewerId
                  : viewerId,
    };
}

function parseReelMediaResponse(
    json: unknown,
    payload: ReelPayload,
): ReelMedia | { mediaId: string } {
    const media = (json as ReelMediaResponse).data?.xdt_shortcode_media;
    const videoUrl = media?.video_url;
    const duration = media?.video_duration;
    const username = media?.owner?.username;
    if (typeof videoUrl !== 'string' || videoUrl.length === 0) {
        const mediaId =
            typeof media?.pk === 'string' && media.pk.length > 0
                ? media.pk
                : typeof media?.id === 'string' && media.id.length > 0
                  ? media.id.split('_')[0]
                  : undefined;
        if (mediaId) return { mediaId };
        throw new Error('Instagram reel video URL was not returned');
    }
    return {
        shortcode: payload.shortcode,
        videoUrl,
        durationSec: typeof duration === 'number' ? duration : 0,
        owner:
            typeof username === 'string' && username.length > 0 ? username : '',
    };
}

function parseReelInfoResponse(json: unknown, payload: ReelPayload): ReelMedia {
    const item = (json as ReelInfoResponse).items?.[0];
    const versions = Array.isArray(item?.video_versions)
        ? item.video_versions
        : [];
    const bestVersion = versions
        .filter(version => typeof version.url === 'string')
        .sort((a, b) => {
            const aHeight = typeof a.height === 'number' ? a.height : 0;
            const bHeight = typeof b.height === 'number' ? b.height : 0;
            if (aHeight !== bHeight) return bHeight - aHeight;
            const aBandwidth =
                typeof a.bandwidth === 'number' ? a.bandwidth : 0;
            const bBandwidth =
                typeof b.bandwidth === 'number' ? b.bandwidth : 0;
            return bBandwidth - aBandwidth;
        })[0];
    const videoUrl = bestVersion?.url;
    if (typeof videoUrl !== 'string' || videoUrl.length === 0)
        throw new Error('Instagram reel video URL was not returned');
    const duration = item?.video_duration;
    const username = item?.user?.username;
    return {
        shortcode: payload.shortcode,
        videoUrl,
        durationSec: typeof duration === 'number' ? duration : 0,
        owner:
            typeof username === 'string' && username.length > 0 ? username : '',
    };
}

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    async main() {
        // Keep webext-bridge out of top-level imports: WXT evaluates this module
        // during build with a fake browser that does not implement runtime.onConnect.
        const { onMessage } = await import('webext-bridge/content-script');
        startAuthProbeListener();
        onMessage<InboxPayload, 'getInbox'>('getInbox', async ({ data }) => {
            try {
                const tokens = await harvestTokens();
                const json = await sendGraphqlRequest(
                    inboxRequest(data, tokens),
                    tokens,
                );
                return ok(parseInboxResponse(json));
            } catch (error) {
                return fail(error);
            }
        });
        onMessage<ThreadPayload, 'getThread'>('getThread', async ({ data }) => {
            try {
                const tokens = await harvestTokens();
                const json = await sendGraphqlRequest(threadRequest(data));
                return ok(parseThreadResponse(json, tokens.viewerId));
            } catch (error) {
                return fail(error);
            }
        });
        onMessage<ReelPayload, 'getReelMedia'>(
            'getReelMedia',
            async ({ data }) => {
                try {
                    if (data.mediaId)
                        return ok(
                            parseReelInfoResponse(
                                await fetchReelInfo(data.mediaId),
                                data,
                            ),
                        );
                    const json = await sendGraphqlRequest(
                        reelMediaRequest(data),
                    );
                    const parsed = parseReelMediaResponse(json, data);
                    if ('mediaId' in parsed)
                        return ok(
                            parseReelInfoResponse(
                                await fetchReelInfo(parsed.mediaId),
                                data,
                            ),
                        );
                    return ok(parsed);
                } catch (error) {
                    return fail(error);
                }
            },
        );
    },
});
