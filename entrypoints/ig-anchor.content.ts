import '../lib/bridge';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { onMessage } from 'webext-bridge/content-script';
import { DOC_IDS, FRIENDLY_NAMES } from '../lib/config';
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
    Result,
    Thread,
    ThreadMessages,
    User,
} from '../lib/domain';

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
    return typeof node.timestamp_ms === 'number'
        ? node.timestamp_ms
        : typeof node.timestamp === 'number'
          ? node.timestamp
          : 0;
}
function senderId(node: Record<string, unknown>): string {
    return typeof node.sender_id === 'string' && node.sender_id.length > 0
        ? node.sender_id
        : typeof node.user_id === 'string' && node.user_id.length > 0
          ? node.user_id
          : '';
}
function reelShortcode(url: string): string | undefined {
    return /\/reel\/([^/?#]+)/.exec(url)?.[1];
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
    const content =
        typeof node.content === 'object' &&
        node.content !== null &&
        !Array.isArray(node.content)
            ? (node.content as Record<string, unknown>)
            : undefined;
    const contentText = content?.text;
    const textBody = node.text_body;
    const repliedToMessage =
        typeof node.replied_to_message === 'object' &&
        node.replied_to_message !== null &&
        !Array.isArray(node.replied_to_message)
            ? (node.replied_to_message as Record<string, unknown>)
            : undefined;
    const repliedToMessageId = repliedToMessage?.message_id;
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
                      : 'Activity',
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
    if (contentType === 'MESSAGE_INLINE_SHARE' && xma && targetUrl && shortcode)
        return {
            kind: 'reel_share',
            id,
            senderId: sender,
            ts,
            shortcode,
            targetUrl,
            thumbUrl:
                typeof xma.preview_image === 'object' &&
                xma.preview_image !== null &&
                !Array.isArray(xma.preview_image) &&
                typeof (xma.preview_image as Record<string, unknown>).url ===
                    'string' &&
                ((xma.preview_image as Record<string, unknown>).url as string)
                    .length > 0
                    ? ((xma.preview_image as Record<string, unknown>)
                          .url as string)
                    : '',
            author:
                typeof xma.header_title_text === 'string' &&
                xma.header_title_text.length > 0
                    ? xma.header_title_text
                    : 'Instagram',
            caption:
                typeof xma.title_text === 'string' && xma.title_text.length > 0
                    ? xma.title_text
                    : typeof xma.caption_body_text === 'string' &&
                        xma.caption_body_text.length > 0
                      ? xma.caption_body_text
                      : undefined,
        };
    return { kind: 'unsupported', id, senderId: sender, ts, contentType };
}

function parseUser(value: unknown): User | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return undefined;
    const user = value as Record<string, unknown>;
    const id =
        typeof user.id === 'string' && user.id.length > 0
            ? user.id
            : typeof user.pk === 'string' && user.pk.length > 0
              ? user.pk
              : typeof user.fbid === 'string' && user.fbid.length > 0
                ? user.fbid
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
    const lastMessage = (Array.isArray(slideMessages?.edges)
        ? slideMessages.edges
        : []
    )
        .map(edge =>
            parseMessage(
                typeof edge === 'object' && edge !== null && !Array.isArray(edge)
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
        typeof container === 'object' && container !== null && !Array.isArray(container)
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
                    typeof (edge as Record<string, unknown>).node === 'object' &&
                    (edge as Record<string, unknown>).node !== null &&
                    !Array.isArray((edge as Record<string, unknown>).node)
                    ? ((edge as Record<string, unknown>).node as Record<
                          string,
                          unknown
                      >).as_ig_direct_thread
                    : undefined,
            ),
        )
        .filter((thread): thread is Thread => Boolean(thread));
    return {
        items,
        cursor:
            typeof pageInfo.end_cursor === 'string' && pageInfo.end_cursor.length > 0
                ? pageInfo.end_cursor
                : undefined,
        hasNextPage: Boolean(pageInfo.has_next_page),
    };
}

function parseMessagePage(container: unknown): ThreadMessages {
    const containerObj =
        typeof container === 'object' && container !== null && !Array.isArray(container)
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
                typeof edge === 'object' && edge !== null && !Array.isArray(edge)
                    ? (edge as Record<string, unknown>).node
                    : undefined,
            ),
        )
        .filter((message): message is Message => Boolean(message))
        .reverse();
    return {
        items,
        cursor:
            typeof pageInfo.end_cursor === 'string' && pageInfo.end_cursor.length > 0
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
            message: error instanceof Error ? error.message : String(error),
        },
    };
}
function inboxPayload(data: unknown): { cursor?: string } {
    return typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        typeof (data as Record<string, unknown>).cursor === 'string'
        ? { cursor: (data as Record<string, string>).cursor }
        : {};
}
function threadPayload(data: unknown): { threadKey: string; cursor?: string } {
    if (
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        typeof (data as Record<string, unknown>).threadKey === 'string'
    )
        return {
            threadKey: (data as Record<string, string>).threadKey,
            cursor:
                typeof (data as Record<string, unknown>).cursor === 'string'
                    ? (data as Record<string, string>).cursor
                    : undefined,
        };
    throw new Error('Invalid thread payload');
}
function reelPayload(data: unknown): { shortcode: string } {
    if (
        typeof data === 'object' &&
        data !== null &&
        !Array.isArray(data) &&
        typeof (data as Record<string, unknown>).shortcode === 'string'
    )
        return { shortcode: (data as Record<string, string>).shortcode };
    throw new Error('Invalid reel payload');
}

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    main() {
        startAuthProbeListener();
        onMessage('getInbox', async ({ data }) => {
            try {
                const tokens = await harvestTokens();
                const payload = inboxPayload(data);
                const json = payload.cursor
                    ? await graphql(
                          FRIENDLY_NAMES.inboxPage,
                          DOC_IDS.inboxPage,
                          {
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
                          '/api/graphql',
                          tokens,
                      )
                    : await graphql(
                          FRIENDLY_NAMES.inbox,
                          DOC_IDS.inbox,
                          {
                              device_id_for_iris_subscription: tokens.deviceId,
                              __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
                              __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
                              __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
                              __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
                              __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
                          },
                          '/api/graphql',
                          tokens,
                      );
                const root =
                    typeof json === 'object' &&
                    json !== null &&
                    !Array.isArray(json) &&
                    typeof (json as Record<string, unknown>).data ===
                        'object' &&
                    (json as Record<string, unknown>).data !== null &&
                    !Array.isArray((json as Record<string, unknown>).data)
                        ? ((json as Record<string, unknown>).data as Record<
                              string,
                              unknown
                          >)
                        : {};
                const slideMailbox =
                    typeof root.get_slide_mailbox_for_iris_subscription ===
                        'object' &&
                    root.get_slide_mailbox_for_iris_subscription !== null &&
                    !Array.isArray(root.get_slide_mailbox_for_iris_subscription)
                        ? (root.get_slide_mailbox_for_iris_subscription as Record<
                              string,
                              unknown
                          >)
                        : undefined;
                const fetchMailbox =
                    typeof root.fetch__SlideMailbox === 'object' &&
                    root.fetch__SlideMailbox !== null &&
                    !Array.isArray(root.fetch__SlideMailbox)
                        ? (root.fetch__SlideMailbox as Record<string, unknown>)
                        : undefined;
                const box =
                    slideMailbox?.threads_by_folder ??
                    fetchMailbox?.threads_by_folder;
                return ok(parseThreads(box));
            } catch (error) {
                return fail(error);
            }
        });
        onMessage('getThread', async ({ data }) => {
            try {
                const payload = threadPayload(data);
                const json = payload.cursor
                    ? await graphql(
                          FRIENDLY_NAMES.olderMessages,
                          DOC_IDS.olderMessages,
                          {
                              after: payload.cursor,
                              before: null,
                              first: 20,
                              last: null,
                              newer_than_message_id: null,
                              older_than_message_id: null,
                              id: payload.threadKey,
                              __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
                          },
                      )
                    : await graphql(FRIENDLY_NAMES.thread, DOC_IDS.thread, {
                          thread_fbid: payload.threadKey,
                          __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false,
                          __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
                          __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
                      });
                const root =
                    typeof json === 'object' &&
                    json !== null &&
                    !Array.isArray(json) &&
                    typeof (json as Record<string, unknown>).data ===
                        'object' &&
                    (json as Record<string, unknown>).data !== null &&
                    !Array.isArray((json as Record<string, unknown>).data)
                        ? ((json as Record<string, unknown>).data as Record<
                              string,
                              unknown
                          >)
                        : {};
                const nullableThread =
                    typeof root.get_slide_thread_nullable === 'object' &&
                    root.get_slide_thread_nullable !== null &&
                    !Array.isArray(root.get_slide_thread_nullable)
                        ? (root.get_slide_thread_nullable as Record<
                              string,
                              unknown
                          >)
                        : undefined;
                const fetchedThread =
                    typeof root.fetch__SlideThread === 'object' &&
                    root.fetch__SlideThread !== null &&
                    !Array.isArray(root.fetch__SlideThread)
                        ? (root.fetch__SlideThread as Record<string, unknown>)
                        : undefined;
                const thread =
                    nullableThread?.as_ig_direct_thread ??
                    fetchedThread?.as_ig_direct_thread;
                const threadObj =
                    typeof thread === 'object' &&
                    thread !== null &&
                    !Array.isArray(thread)
                        ? (thread as Record<string, unknown>)
                        : undefined;
                return ok(
                    parseMessagePage(threadObj?.slide_messages),
                );
            } catch (error) {
                return fail(error);
            }
        });
        onMessage('getReelMedia', async ({ data }) => {
            try {
                const payload = reelPayload(data);
                const json = await graphql(
                    FRIENDLY_NAMES.reelMedia,
                    DOC_IDS.reelMedia,
                    {
                        shortcode: payload.shortcode,
                        fetch_tagged_user_count: null,
                        hoisted_comment_id: null,
                        hoisted_reply_id: null,
                    },
                    '/graphql/query',
                );
                const dataObj =
                    typeof json === 'object' &&
                    json !== null &&
                    !Array.isArray(json) &&
                    typeof (json as Record<string, unknown>).data ===
                        'object' &&
                    (json as Record<string, unknown>).data !== null &&
                    !Array.isArray((json as Record<string, unknown>).data)
                        ? ((json as Record<string, unknown>).data as Record<
                              string,
                              unknown
                          >)
                        : undefined;
                const media =
                    typeof dataObj?.xdt_shortcode_media === 'object' &&
                    dataObj.xdt_shortcode_media !== null &&
                    !Array.isArray(dataObj.xdt_shortcode_media)
                        ? (dataObj.xdt_shortcode_media as Record<
                              string,
                              unknown
                          >)
                        : undefined;
                const videoUrl =
                    typeof media?.video_url === 'string' &&
                    media.video_url.length > 0
                        ? media.video_url
                        : undefined;
                if (!videoUrl)
                    throw new Error(
                        'Instagram reel video URL was not returned',
                    );
                return ok<ReelMedia>({
                    shortcode: payload.shortcode,
                    videoUrl,
                    durationSec:
                        typeof media?.video_duration === 'number'
                            ? media.video_duration
                            : 0,
                    owner:
                        typeof media?.owner === 'object' &&
                        media.owner !== null &&
                        !Array.isArray(media.owner) &&
                        typeof (media.owner as Record<string, unknown>)
                            .username === 'string' &&
                        ((media.owner as Record<string, unknown>).username as string)
                            .length > 0
                            ? ((media.owner as Record<string, unknown>)
                                  .username as string)
                            : '',
                });
            } catch (error) {
                return fail(error);
            }
        });
    },
});
