import "../lib/bridge";
import { defineContentScript } from "wxt/utils/define-content-script";
import { onMessage } from "webext-bridge/content-script";
import { DOC_IDS, FRIENDLY_NAMES } from "../lib/config";
import type {
    Folder,
    Message,
    Page,
    ReelMedia,
    Result,
    Thread,
    ThreadMessages,
    User,
} from "../lib/domain";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
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

const AUTH_PROBE_EVENT = "icr:ig-auth-probe";
const AUTH_PROBE_REQUEST_EVENT = "icr:ig-auth-probe-request";
let pageAuthProbe: PageAuthProbe = {};

function isObj(value: Json | undefined | unknown): value is Obj {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: Json | undefined): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function num(value: Json | undefined): number | undefined {
    return typeof value === "number" ? value : undefined;
}
function arr(value: Json | undefined): Json[] {
    return Array.isArray(value) ? value : [];
}

function findString(root: Json, keys: string[]): string | undefined {
    if (!isObj(root)) return undefined;
    for (const key of keys) {
        const value = str(root[key]);
        if (value) return value;
    }
    for (const value of Object.values(root)) {
        const found = Array.isArray(value)
            ? value.map((item) => findString(item, keys)).find(Boolean)
            : findString(value, keys);
        if (found) return found;
    }
    return undefined;
}

function pageJson(): Json[] {
    return Array.from(
        document.querySelectorAll(
            'script[type="application/json"][data-sjs], script[data-sjs]',
        ),
    )
        .map((node) => node.textContent ?? "")
        .flatMap((text) => {
            try {
                return [JSON.parse(text) as Json];
            } catch {
                return [];
            }
        });
}

function pageText(): string {
    return `${document.documentElement.innerHTML}\n${Array.from(document.scripts)
        .map((script) => script.textContent ?? "")
        .join("\n")}`;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1]) return decodeURIComponent(match[1].replaceAll("\\/", "/"));
    }
    return undefined;
}

function jsonString(value: Json | undefined, key: string): string | undefined {
    return isObj(value) ? str(value[key]) : undefined;
}

function readProbeToken(key: TokenKey): string | undefined {
    return str(pageAuthProbe[key]);
}

function source(sources: TokenSources, key: TokenKey, value: string | undefined, from: string): string | undefined {
    if (value) sources[key] = from;
    return value;
}

function deriveJazoest(fbDtsg: string | undefined): string | undefined {
    if (!fbDtsg) return undefined;
    return `2${Array.from(fbDtsg).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
}

function deviceIdFallback(sources: TokenSources): string {
    const stored = localStorage.getItem("chatd-deviceid");
    if (stored) {
        sources.deviceId = "localStorage.chatd-deviceid";
        return stored;
    }
    const generated = crypto.randomUUID();
    localStorage.setItem("chatd-deviceid", generated);
    sources.deviceId = "generated chatd-deviceid";
    return generated;
}

function masked(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (value.length <= 10) return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length})`;
    return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length})`;
}

function cookie(name: string): string | undefined {
    return document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");
}

function authDiagnostics(values: Partial<Tokens>, sources: TokenSources) {
    const keys: TokenKey[] = ["fbDtsg", "lsd", "jazoest", "csrfToken", "deviceId", "viewerId"];
    return {
        url: location.href,
        readyState: document.readyState,
        scriptCount: document.scripts.length,
        dataSjsScriptCount: document.querySelectorAll("script[data-sjs]").length,
        jsonRootCount: pageJson().length,
        cookies: {
            csrftoken: Boolean(cookie("csrftoken")),
            ds_user_id: Boolean(cookie("ds_user_id")),
            sessionid: Boolean(cookie("sessionid")),
        },
        localStorage: {
            chatdDeviceId: Boolean(localStorage.getItem("chatd-deviceid")),
        },
        mainWorldProbe: {
            received: Boolean(pageAuthProbe.at),
            ageMs: pageAuthProbe.at ? Date.now() - pageAuthProbe.at : undefined,
            requireAvailable: pageAuthProbe.requireAvailable,
        },
        tokens: Object.fromEntries(
            keys.map((key) => [
                key,
                {
                    found: Boolean(values[key]),
                    source: sources[key],
                    sample: masked(values[key]),
                },
            ]),
        ),
        missing: keys.filter((key) => !values[key]),
    };
}

function authError(values: Partial<Tokens>, sources: TokenSources): Error {
    const debug = authDiagnostics(values, sources);
    return new Error(
        `Instagram auth tokens were not found (${debug.missing.join(", ")}); open or refresh instagram.com/direct/inbox first. Debug: ${JSON.stringify(debug)}`,
    );
}

function requestAuthProbe() {
    window.dispatchEvent(new Event(AUTH_PROBE_REQUEST_EVENT));
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function startAuthProbeListener() {
    window.addEventListener(AUTH_PROBE_EVENT, (event) => {
        const detail = "detail" in event && typeof event.detail === "string" ? event.detail : undefined;
        if (!detail) return;
        try {
            const data = JSON.parse(detail) as Json;
            if (!isObj(data)) return;
            const sources = isObj(data.sources) ? data.sources : {};
            pageAuthProbe = {
                fbDtsg: jsonString(data, "fbDtsg"),
                lsd: jsonString(data, "lsd"),
                jazoest: jsonString(data, "jazoest"),
                deviceId: jsonString(data, "deviceId"),
                viewerId: jsonString(data, "viewerId"),
                at: typeof data.at === "number" ? data.at : Date.now(),
                requireAvailable: Boolean(data.requireAvailable),
                sources: {
                    fbDtsg: jsonString(sources, "fbDtsg"),
                    lsd: jsonString(sources, "lsd"),
                    jazoest: jsonString(sources, "jazoest"),
                    deviceId: jsonString(sources, "deviceId"),
                    viewerId: jsonString(sources, "viewerId"),
                },
            };
        } catch {
            pageAuthProbe = { at: Date.now(), requireAvailable: false };
        }
    });
}

function harvestTokensNow(): Tokens {
    const roots = pageJson();
    const text = pageText();
    const sources: TokenSources = {};
    const fbDtsg =
        source(sources, "fbDtsg", readProbeToken("fbDtsg"), pageAuthProbe.sources?.fbDtsg ?? "main-world probe") ??
        source(sources, "fbDtsg", roots.map((root) => findString(root, ["fb_dtsg"])).find(Boolean), "script[data-sjs] JSON") ??
        source(sources, "fbDtsg", firstMatch(text, [
            /fb_dtsg=([^&"'\\]+)/,
            /"DTSGInitialData"[^]*?"token"\s*:\s*"([^"]+)"/,
            /"fb_dtsg"\s*:\s*"([^"]+)"/,
        ]), "page text");
    const lsd =
        source(sources, "lsd", readProbeToken("lsd"), pageAuthProbe.sources?.lsd ?? "main-world probe") ??
        source(sources, "lsd", roots.map((root) => findString(root, ["lsd"])).find(Boolean), "script[data-sjs] JSON") ??
        source(sources, "lsd", firstMatch(text, [
            /lsd=([^&"'\\]+)/,
            /"LSD"[^]*?"token"\s*:\s*"([^"]+)"/,
            /"lsd"\s*:\s*"([^"]+)"/,
        ]), "page text");
    const jazoest =
        source(sources, "jazoest", readProbeToken("jazoest"), pageAuthProbe.sources?.jazoest ?? "main-world probe") ??
        source(sources, "jazoest", roots.map((root) => findString(root, ["jazoest"])).find(Boolean), "script[data-sjs] JSON") ??
        source(sources, "jazoest", firstMatch(text, [
            /jazoest=([^&"'\\]+)/,
            /"jazoest"\s*:\s*"([^"]+)"/,
        ]), "page text") ??
        source(sources, "jazoest", deriveJazoest(fbDtsg), "derived from fb_dtsg");
    const deviceId =
        source(sources, "deviceId", readProbeToken("deviceId"), pageAuthProbe.sources?.deviceId ?? "main-world probe") ??
        source(sources, "deviceId", roots.map((root) => findString(root, ["device_id_for_iris_subscription"])).find(Boolean), "script[data-sjs] JSON") ??
        source(sources, "deviceId", firstMatch(text, [
            /"device_id_for_iris_subscription"\s*:\s*"([^"]+)"/,
            /device_id_for_iris_subscription=([^&"'\\]+)/,
        ]), "page text") ??
        deviceIdFallback(sources);
    const viewerId =
        source(sources, "viewerId", readProbeToken("viewerId"), pageAuthProbe.sources?.viewerId ?? "main-world probe") ??
        source(sources, "viewerId", roots.map((root) =>
            findString(root, [
                "viewer_fbid",
                "actorID",
                "USER_ID",
                "account_id",
            ]),
        ).find(Boolean), "script[data-sjs] JSON") ??
        source(sources, "viewerId", firstMatch(text, [
            /"viewer_fbid"\s*:\s*"?(\d+)/,
            /"actorID"\s*:\s*"?(\d+)/,
            /"USER_ID"\s*:\s*"?(\d+)/,
        ]), "page text") ??
        source(sources, "viewerId", cookie("ds_user_id"), "ds_user_id cookie") ??
        source(sources, "viewerId", fbDtsg?.split(":")[1], "fb_dtsg segment");
    const csrfToken = source(sources, "csrfToken", cookie("csrftoken"), "csrftoken cookie");
    if (!fbDtsg || !lsd || !jazoest || !deviceId || !viewerId || !csrfToken)
        throw authError({ fbDtsg, lsd, jazoest, deviceId, viewerId, csrfToken }, sources);
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
    variables: Obj,
    endpoint = "/api/graphql",
): Promise<Json> {
    const tokens = await harvestTokens();
    const body = new URLSearchParams({
        __d: "www",
        __a: "1",
        __comet_req: "7",
        dpr: "2",
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: friendlyName,
        server_timestamps: "true",
        fb_dtsg: tokens.fbDtsg,
        lsd: tokens.lsd,
        jazoest: tokens.jazoest,
        variables: JSON.stringify(variables),
        doc_id: docId,
    });
    const response = await fetch(`https://www.instagram.com${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-ig-app-id": "936619743392459",
            "x-asbd-id": "359341",
            "x-fb-lsd": tokens.lsd,
            "x-fb-friendly-name": friendlyName,
            "x-csrftoken": tokens.csrfToken,
        },
        body,
    });
    if (!response.ok)
        throw new Error(
            `Instagram GraphQL ${friendlyName} failed with ${response.status}`,
        );
    return response.json() as Promise<Json>;
}

function messageId(node: Obj): string {
    return (
        str(node.message_id) ??
        str(node.item_id) ??
        str(node.id) ??
        crypto.randomUUID()
    );
}
function messageTs(node: Obj): number {
    return num(node.timestamp_ms) ?? num(node.timestamp) ?? 0;
}
function senderId(node: Obj): string {
    return str(node.sender_id) ?? str(node.user_id) ?? "";
}
function reelShortcode(url: string): string | undefined {
    return /\/reel\/([^/?#]+)/.exec(url)?.[1];
}

function parseMessage(value: Json | undefined): Message | undefined {
    if (!isObj(value)) return undefined;
    const id = messageId(value);
    const ts = messageTs(value);
    const sender = senderId(value);
    const contentType = str(value.content_type) ?? "UNKNOWN";
    const content = isObj(value.content) ? value.content : undefined;
    if (contentType === "TEXT")
        return {
            kind: "text",
            id,
            senderId: sender,
            ts,
            text: str(value.text_body) ?? str(content?.text) ?? "",
            repliedTo: str(
                (isObj(value.replied_to_message)
                    ? value.replied_to_message
                    : undefined
                )?.message_id,
            ),
        };
    if (contentType === "ACTION_LOG" || contentType === "REACTION_LOG")
        return {
            kind: "reaction_log",
            id,
            ts,
            fragment: str(value.text_body) ?? str(content?.text) ?? "Activity",
        };
    const xma = isObj(content?.xma) ? content.xma : undefined;
    const targetUrl = str(xma?.target_url);
    const shortcode = targetUrl ? reelShortcode(targetUrl) : undefined;
    if (contentType === "MESSAGE_INLINE_SHARE" && xma && targetUrl && shortcode)
        return {
            kind: "reel_share",
            id,
            senderId: sender,
            ts,
            shortcode,
            targetUrl,
            thumbUrl:
                str(
                    (isObj(xma.preview_image) ? xma.preview_image : undefined)
                        ?.url,
                ) ?? "",
            author: str(xma.header_title_text) ?? "Instagram",
            caption: str(xma.title_text) ?? str(xma.caption_body_text),
        };
    return { kind: "unsupported", id, senderId: sender, ts, contentType };
}

function parseUser(value: Json): User | undefined {
    if (!isObj(value)) return undefined;
    const id = str(value.id) ?? str(value.pk) ?? str(value.fbid);
    if (!id) return undefined;
    return {
        id,
        username: str(value.username) ?? "",
        fullName: str(value.full_name) ?? str(value.name) ?? "",
        picUrl:
            str(value.profile_pic_url) ?? str(value.profile_pic_url_hd) ?? null,
    };
}

function parseThread(value: Json | undefined): Thread | undefined {
    if (!isObj(value)) return undefined;
    const key =
        str(value.thread_key) ?? str(value.thread_fbid) ?? str(value.id);
    if (!key) return undefined;
    const users = arr(value.users)
        .map(parseUser)
        .filter((user): user is User => Boolean(user));
    const lastMessage = arr(
        isObj(value.slide_messages) ? value.slide_messages.edges : undefined,
    )
        .map((edge) => parseMessage(isObj(edge) ? edge.node : undefined))
        .find(Boolean);
    const generatedTitle = users
        .map((u) => u.username || u.fullName)
        .filter(Boolean)
        .join(", ");
    return {
        key,
        title: str(value.thread_title) ?? (generatedTitle || "Untitled"),
        isGroup: Boolean(value.is_group_thread),
        isMuted: Boolean(value.muted),
        folder: (str(value.folder) as Folder | undefined) ?? "PRIMARY",
        lastActivityMs:
            num(value.last_activity_at_ms) ?? num(value.last_activity_ms) ?? 0,
        serverIsPin: Boolean(value.is_pin),
        users,
        lastMessage,
        cursor: str(value.thread_fbid) ?? key,
    };
}

function parseThreads(container: Json | undefined): Page<Thread> {
    const pageInfo =
        isObj(container) && isObj(container.page_info)
            ? container.page_info
            : {};
    const items = arr(isObj(container) ? container.edges : undefined)
        .map((edge) =>
            parseThread(
                isObj(edge) && isObj(edge.node)
                    ? edge.node.as_ig_direct_thread
                    : undefined,
            ),
        )
        .filter((thread): thread is Thread => Boolean(thread));
    return {
        items,
        cursor: str(pageInfo.end_cursor),
        hasNextPage: Boolean(pageInfo.has_next_page),
    };
}

function parseMessagePage(container: Json | undefined): ThreadMessages {
    const pageInfo =
        isObj(container) && isObj(container.page_info)
            ? container.page_info
            : {};
    const items = arr(isObj(container) ? container.edges : undefined)
        .map((edge) => parseMessage(isObj(edge) ? edge.node : undefined))
        .filter((message): message is Message => Boolean(message))
        .reverse();
    return {
        items,
        cursor: str(pageInfo.end_cursor),
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
    return isObj(data) && typeof data.cursor === "string"
        ? { cursor: data.cursor }
        : {};
}
function threadPayload(data: unknown): { threadKey: string; cursor?: string } {
    if (isObj(data) && typeof data.threadKey === "string")
        return {
            threadKey: data.threadKey,
            cursor: typeof data.cursor === "string" ? data.cursor : undefined,
        };
    throw new Error("Invalid thread payload");
}
function reelPayload(data: unknown): { shortcode: string } {
    if (isObj(data) && typeof data.shortcode === "string")
        return { shortcode: data.shortcode };
    throw new Error("Invalid reel payload");
}

export default defineContentScript({
    matches: ["https://www.instagram.com/*"],
    runAt: "document_idle",
    main() {
        startAuthProbeListener();
        onMessage("debugAuth", async () => {
            try {
                const tokens = await harvestTokens();
                return ok(authDiagnostics(tokens, {
                    fbDtsg: "resolved",
                    lsd: "resolved",
                    jazoest: "resolved",
                    csrfToken: "resolved",
                    deviceId: "resolved",
                    viewerId: "resolved",
                }));
            } catch (error) {
                return fail(error);
            }
        });
        onMessage("getInbox", async ({ data }) => {
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
                              folder: "INBOX",
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
                const root = isObj(json) && isObj(json.data) ? json.data : {};
                const box = isObj(root.get_slide_mailbox_for_iris_subscription)
                    ? root.get_slide_mailbox_for_iris_subscription
                          .threads_by_folder
                    : isObj(root.fetch__SlideMailbox)
                      ? root.fetch__SlideMailbox.threads_by_folder
                      : undefined;
                return ok(parseThreads(box));
            } catch (error) {
                return fail(error);
            }
        });
        onMessage("getThread", async ({ data }) => {
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
                const root = isObj(json) && isObj(json.data) ? json.data : {};
                const thread = isObj(root.get_slide_thread_nullable)
                    ? root.get_slide_thread_nullable.as_ig_direct_thread
                    : isObj(root.fetch__SlideThread)
                      ? root.fetch__SlideThread.as_ig_direct_thread
                      : undefined;
                return ok(
                    parseMessagePage(
                        isObj(thread) ? thread.slide_messages : undefined,
                    ),
                );
            } catch (error) {
                return fail(error);
            }
        });
        onMessage("getReelMedia", async ({ data }) => {
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
                    "/graphql/query",
                );
                const media =
                    isObj(json) &&
                    isObj(json.data) &&
                    isObj(json.data.xdt_shortcode_media)
                        ? json.data.xdt_shortcode_media
                        : undefined;
                const videoUrl = str(media?.video_url);
                if (!videoUrl)
                    throw new Error(
                        "Instagram reel video URL was not returned",
                    );
                return ok<ReelMedia>({
                    shortcode: payload.shortcode,
                    videoUrl,
                    durationSec: num(media?.video_duration) ?? 0,
                    owner:
                        str(
                            isObj(media?.owner)
                                ? media.owner.username
                                : undefined,
                        ) ?? "",
                });
            } catch (error) {
                return fail(error);
            }
        });
    },
});
