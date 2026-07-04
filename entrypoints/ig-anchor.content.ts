import '../lib/bridge';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { onMessage } from 'webext-bridge/content-script';
import { DOC_IDS, FRIENDLY_NAMES } from '../lib/config';
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

type Tokens = {
    fbDtsg: string;
    lsd: string;
    jazoest: string;
    csrfToken: string;
    deviceId: string;
    viewerId: string;
};
type TokenKey = keyof Tokens;
type TokenSources = Partial<Record<TokenKey, string>>;
type PageAuthProbe = Partial<Tokens> & {
    at?: number;
    requireAvailable?: boolean;
    sources?: Partial<Record<TokenKey, string>>;
};
type AuthProbePayload = Partial<
    Pick<Tokens, 'fbDtsg' | 'lsd' | 'jazoest' | 'deviceId' | 'viewerId'>
> & {
    at: number;
    requireAvailable: boolean;
    sources: Partial<Record<TokenKey, string>>;
};

const AUTH_PROBE_EVENT = 'icr:ig-auth-probe';
const AUTH_PROBE_REQUEST_EVENT = 'icr:ig-auth-probe-request';
let pageAuthProbe: PageAuthProbe = {};

function findString(root: unknown, keys: string[]): string | undefined {
    if (typeof root !== 'object' || root === null || Array.isArray(root))
        return undefined;
    const rootObj = root as Record<string, unknown>;
    for (const key of keys) {
        const value = rootObj[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    for (const value of Object.values(rootObj)) {
        const found = Array.isArray(value)
            ? value.map(item => findString(item, keys)).find(Boolean)
            : findString(value, keys);
        if (found) return found;
    }
    return undefined;
}

function pageJson(): unknown[] {
    return Array.from(
        document.querySelectorAll(
            'script[type="application/json"][data-sjs], script[data-sjs]',
        ),
    )
        .map(node => node.textContent ?? '')
        .flatMap(text => {
            try {
                return [JSON.parse(text) as unknown];
            } catch {
                return [];
            }
        });
}

function pageText(): string {
    return `${document.documentElement.innerHTML}\n${Array.from(
        document.scripts,
    )
        .map(script => script.textContent ?? '')
        .join('\n')}`;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1])
            return decodeURIComponent(match[1].replaceAll('\\/', '/'));
    }
    return undefined;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.length > 0) return value;
    throw new Error(`Invalid Instagram auth probe ${field}`);
}

function parseAuthProbe(detail: string): AuthProbePayload {
    const data = JSON.parse(detail) as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data))
        throw new Error('Invalid Instagram auth probe payload');
    const dataObj = data as Record<string, unknown>;
    if (typeof dataObj.at !== 'number')
        throw new Error('Invalid Instagram auth probe at');
    if (typeof dataObj.requireAvailable !== 'boolean')
        throw new Error('Invalid Instagram auth probe requireAvailable');
    if (
        typeof dataObj.sources !== 'object' ||
        dataObj.sources === null ||
        Array.isArray(dataObj.sources) ||
        Object.keys(dataObj.sources).length === 0
    )
        throw new Error('Invalid Instagram auth probe sources');
    const sourcesObj = dataObj.sources as Record<string, unknown>;
    return {
        fbDtsg: optionalString(dataObj.fbDtsg, 'fbDtsg'),
        lsd: optionalString(dataObj.lsd, 'lsd'),
        jazoest: optionalString(dataObj.jazoest, 'jazoest'),
        deviceId: optionalString(dataObj.deviceId, 'deviceId'),
        viewerId: optionalString(dataObj.viewerId, 'viewerId'),
        at: dataObj.at,
        requireAvailable: dataObj.requireAvailable,
        sources: {
            fbDtsg: optionalString(sourcesObj.fbDtsg, 'sources.fbDtsg'),
            lsd: optionalString(sourcesObj.lsd, 'sources.lsd'),
            jazoest: optionalString(sourcesObj.jazoest, 'sources.jazoest'),
            deviceId: optionalString(sourcesObj.deviceId, 'sources.deviceId'),
            viewerId: optionalString(sourcesObj.viewerId, 'sources.viewerId'),
        },
    };
}

function readProbeToken(key: TokenKey): string | undefined {
    const value = pageAuthProbe[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function source(
    sources: TokenSources,
    key: TokenKey,
    value: string | undefined,
    from: string,
): string | undefined {
    if (value) sources[key] = from;
    return value;
}

function deriveJazoest(fbDtsg: string | undefined): string | undefined {
    if (!fbDtsg) return undefined;
    return `2${Array.from(fbDtsg).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
}

function deviceIdFallback(sources: TokenSources): string {
    const stored = localStorage.getItem('chatd-deviceid');
    if (stored) {
        sources.deviceId = 'localStorage.chatd-deviceid';
        return stored;
    }
    const generated = crypto.randomUUID();
    localStorage.setItem('chatd-deviceid', generated);
    sources.deviceId = 'generated chatd-deviceid';
    return generated;
}

function cookie(name: string): string | undefined {
    return document.cookie
        .split('; ')
        .find(part => part.startsWith(`${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');
}

function authError(values: Partial<Tokens>): Error {
    const keys: TokenKey[] = [
        'fbDtsg',
        'lsd',
        'jazoest',
        'csrfToken',
        'deviceId',
        'viewerId',
    ];
    const missing = keys.filter(key => !values[key]);
    return new Error(
        `Instagram auth tokens were not found (${missing.join(', ')}); open or refresh instagram.com/direct/inbox first.`,
    );
}

function requestAuthProbe() {
    window.dispatchEvent(new Event(AUTH_PROBE_REQUEST_EVENT));
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function startAuthProbeListener() {
    window.addEventListener(AUTH_PROBE_EVENT, event => {
        const detail =
            'detail' in event && typeof event.detail === 'string'
                ? event.detail
                : undefined;
        if (!detail) return;

        const data = parseAuthProbe(detail);
        pageAuthProbe = data;
    });
}

function harvestTokensNow(): Tokens {
    const roots = pageJson();
    const text = pageText();
    const sources: TokenSources = {};
    const fbDtsg =
        source(
            sources,
            'fbDtsg',
            readProbeToken('fbDtsg'),
            pageAuthProbe.sources?.fbDtsg ?? 'main-world probe',
        ) ??
        source(
            sources,
            'fbDtsg',
            roots.map(root => findString(root, ['fb_dtsg'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'fbDtsg',
            firstMatch(text, [
                /fb_dtsg=([^&"'\\]+)/,
                /"DTSGInitialData"[^]*?"token"\s*:\s*"([^"]+)"/,
                /"fb_dtsg"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        );
    const lsd =
        source(
            sources,
            'lsd',
            readProbeToken('lsd'),
            pageAuthProbe.sources?.lsd ?? 'main-world probe',
        ) ??
        source(
            sources,
            'lsd',
            roots.map(root => findString(root, ['lsd'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'lsd',
            firstMatch(text, [
                /lsd=([^&"'\\]+)/,
                /"LSD"[^]*?"token"\s*:\s*"([^"]+)"/,
                /"lsd"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        );
    const jazoest =
        source(
            sources,
            'jazoest',
            readProbeToken('jazoest'),
            pageAuthProbe.sources?.jazoest ?? 'main-world probe',
        ) ??
        source(
            sources,
            'jazoest',
            roots.map(root => findString(root, ['jazoest'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'jazoest',
            firstMatch(text, [
                /jazoest=([^&"'\\]+)/,
                /"jazoest"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        ) ??
        source(
            sources,
            'jazoest',
            deriveJazoest(fbDtsg),
            'derived from fb_dtsg',
        );
    const deviceId =
        source(
            sources,
            'deviceId',
            readProbeToken('deviceId'),
            pageAuthProbe.sources?.deviceId ?? 'main-world probe',
        ) ??
        source(
            sources,
            'deviceId',
            roots
                .map(root =>
                    findString(root, ['device_id_for_iris_subscription']),
                )
                .find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'deviceId',
            firstMatch(text, [
                /"device_id_for_iris_subscription"\s*:\s*"([^"]+)"/,
                /device_id_for_iris_subscription=([^&"'\\]+)/,
            ]),
            'page text',
        ) ??
        deviceIdFallback(sources);
    const viewerId =
        source(
            sources,
            'viewerId',
            readProbeToken('viewerId'),
            pageAuthProbe.sources?.viewerId ?? 'main-world probe',
        ) ??
        source(
            sources,
            'viewerId',
            roots
                .map(root =>
                    findString(root, [
                        'viewer_fbid',
                        'actorID',
                        'USER_ID',
                        'account_id',
                    ]),
                )
                .find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'viewerId',
            firstMatch(text, [
                /"viewer_fbid"\s*:\s*"?(\d+)/,
                /"actorID"\s*:\s*"?(\d+)/,
                /"USER_ID"\s*:\s*"?(\d+)/,
            ]),
            'page text',
        ) ??
        source(
            sources,
            'viewerId',
            cookie('ds_user_id'),
            'ds_user_id cookie',
        ) ??
        source(sources, 'viewerId', fbDtsg?.split(':')[1], 'fb_dtsg segment');
    const csrfToken = source(
        sources,
        'csrfToken',
        cookie('csrftoken'),
        'csrftoken cookie',
    );
    if (!fbDtsg || !lsd || !jazoest || !deviceId || !viewerId || !csrfToken)
        throw authError({ fbDtsg, lsd, jazoest, deviceId, viewerId, csrfToken });
    return { fbDtsg, lsd, jazoest, csrfToken, deviceId, viewerId };
}

async function harvestTokens(): Promise<Tokens> {
    requestAuthProbe();
    await wait(50);
    try {
        return harvestTokensNow();
    } catch (error) {
        requestAuthProbe();
        await wait(300);
        try {
            return harvestTokensNow();
        } catch {
            throw error;
        }
    }
}

async function graphql(
    friendlyName: string,
    docId: string,
    variables: Record<string, unknown>,
    endpoint = '/api/graphql',
): Promise<unknown> {
    const tokens = await harvestTokens();
    const body = new URLSearchParams({
        __d: 'www',
        __a: '1',
        __comet_req: '7',
        dpr: '2',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: friendlyName,
        server_timestamps: 'true',
        fb_dtsg: tokens.fbDtsg,
        lsd: tokens.lsd,
        jazoest: tokens.jazoest,
        variables: JSON.stringify(variables),
        doc_id: docId,
    });
    const response = await fetch(`https://www.instagram.com${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '359341',
            'x-fb-lsd': tokens.lsd,
            'x-fb-friendly-name': friendlyName,
            'x-csrftoken': tokens.csrfToken,
        },
        body,
    });
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
                      )
                    : await graphql(FRIENDLY_NAMES.inbox, DOC_IDS.inbox, {
                          device_id_for_iris_subscription: tokens.deviceId,
                          __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
                          __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
                          __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
                          __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
                          __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: false,
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
