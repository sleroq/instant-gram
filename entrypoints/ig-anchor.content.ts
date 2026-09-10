import '../lib/bridge';
import browser from 'webextension-polyfill';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { DOC_IDS, FRIENDLY_NAMES, INSTAGRAM_GRAPHQL_FLAGS } from '../lib/config';
import { getErrorMessage } from '../lib/errors';
import {
    clearTokenCache,
    harvestTokens,
    startAuthProbeListener,
    type Tokens,
} from '../lib/ig-auth';
import {
    buildReelCommentRepliesPath,
    INSTAGRAM_GRAPHQL_OPERATIONS,
    type InstagramGraphqlDescriptor,
    type InstagramGraphqlOperationName,
} from '../lib/instagram-api/catalog';
import { createInstagramRpcHandlers } from '../lib/instagram-api/handlers';
import {
    parseCreatedReelCommentResponse,
    parseReelCommentLikeResponse,
    parseReelCommentRepliesResponse,
    parseReelCommentsResponse,
} from '../lib/instagram-api/parsers';
import { loadReelMedia } from '../lib/instagram-api/reels';
import type { Result, RpcMap } from '../lib/domain';
import { registerInboxProvider } from '../lib/provider/inbox-content';

type ReelCommentsPayload = Parameters<RpcMap['getReelComments']>[0];
type ReelRepliesPayload = Parameters<RpcMap['getReelCommentReplies']>[0];
type CreateReelCommentPayload = Parameters<RpcMap['createReelComment']>[0];
type ReelCommentLikePayload = Parameters<RpcMap['setReelCommentLiked']>[0];
type RemoteRpcName = Exclude<keyof RpcMap, 'getPins'>;
const REMOTE_RPC_NAMES = [
    'getInbox',
    'getThread',
    'getReelMedia',
    'getReelComments',
    'getReelCommentReplies',
    'createReelComment',
    'setReelCommentLiked',
    'setReelLiked',
    'setReelSaved',
    'sendText',
    'editText',
    'forwardMessage',
    'setReaction',
    'togglePin',
    'markThreadRead',
] as const satisfies readonly RemoteRpcName[];

type GraphqlRequest = {
    friendlyName: string;
    docId: string;
    variables: Record<string, unknown>;
    endpoint: '/api/graphql' | '/graphql/query';
    kind: 'query' | 'mutation';
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function graphqlErrorDetails(
    operation: string,
    errors: unknown[],
): string {
    const first = errors.find(isRecord);
    const code =
        typeof first?.code === 'number' || typeof first?.code === 'string'
            ? String(first.code)
            : undefined;
    const summary =
        typeof first?.summary === 'string' ? first.summary.slice(0, 80) : undefined;
    const path = Array.isArray(first?.path)
        ? first.path.filter(part => typeof part === 'string').join('.')
        : undefined;
    const requestId =
        typeof first?.www_request_id === 'string'
            ? first.www_request_id.slice(0, 80)
            : undefined;
    return [
        `Instagram GraphQL ${operation} failed`,
        code && `code ${code}`,
        summary,
        path && `path ${path}`,
        requestId && `request ${requestId}`,
    ]
        .filter(Boolean)
        .join(' · ');
}

function safeErrorMessage(error: unknown): string {
    const message = getErrorMessage(error)
        .replaceAll(/https?:\/\/\S+/g, '[URL]')
        .replaceAll(/(fb_dtsg|lsd|jazoest|csrftoken)=[^\s&]+/gi, '$1=[redacted]');
    return message.slice(0, 300) || 'Instagram request failed';
}

function ok<T>(value: T): Result<T> {
    return { ok: true, value };
}

function fail(error: unknown): Result<never> {
    return { ok: false, error: { message: safeErrorMessage(error) } };
}

async function graphql(
    request: GraphqlRequest,
    suppliedTokens?: Tokens,
): Promise<unknown> {
    const post = (auth: Tokens) => {
        const body = new URLSearchParams({
            __d: 'www',
            __a: '1',
            __comet_req: '7',
            dpr: '2',
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: request.friendlyName,
            server_timestamps: 'true',
            fb_dtsg: auth.fbDtsg,
            lsd: auth.lsd,
            jazoest: auth.jazoest,
            variables: JSON.stringify(request.variables),
            doc_id: request.docId,
        });
        return fetch(`https://www.instagram.com${request.endpoint}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '359341',
                'x-fb-lsd': auth.lsd,
                'x-fb-friendly-name': request.friendlyName,
                'x-csrftoken': auth.csrfToken,
            },
            body,
        });
    };

    let tokens = suppliedTokens ?? (await harvestTokens());
    let response = await post(tokens);
    if (response.status === 401 || response.status === 403) {
        clearTokenCache();
        if (request.kind === 'mutation')
            throw new Error('Instagram authentication expired before mutation completed');
        tokens = await harvestTokens(true);
        response = await post(tokens);
    }
    if (!response.ok)
        throw new Error(`Instagram GraphQL request failed with ${response.status}`);

    let json: unknown;
    try {
        json = await response.json();
    } catch {
        throw new Error('Instagram GraphQL returned an invalid response');
    }
    if (isRecord(json) && json.errors !== undefined) {
        if (!Array.isArray(json.errors))
            throw new Error('Instagram GraphQL returned an invalid response');
        if (json.errors.length > 0)
            throw new Error(
                graphqlErrorDetails(request.friendlyName, json.errors),
            );
    }
    return json;
}

function operationRequest(
    operation: InstagramGraphqlOperationName,
    input: Record<string, unknown>,
    tokens: Tokens,
): GraphqlRequest {
    const descriptor = INSTAGRAM_GRAPHQL_OPERATIONS[operation] as InstagramGraphqlDescriptor<Record<string, unknown>>;
    return {
        friendlyName: descriptor.friendlyName,
        docId: descriptor.docId,
        endpoint: descriptor.endpoint,
        kind: descriptor.kind,
        variables: descriptor.buildVariables(input, {
            viewerId: tokens.viewerId,
            deviceId: tokens.deviceId,
        }),
    };
}

function olderMessagesRequest(input: Record<string, unknown>): GraphqlRequest {
    return {
        friendlyName: FRIENDLY_NAMES.olderMessages,
        docId: DOC_IDS.olderMessages,
        endpoint: '/api/graphql',
        kind: 'query',
        variables: {
            after: input.cursor,
            before: null,
            first: INSTAGRAM_GRAPHQL_FLAGS.initialMessagePageCount,
            last: null,
            newer_than_message_id: null,
            older_than_message_id: null,
            id: input.threadKey,
            __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:
                INSTAGRAM_GRAPHQL_FLAGS.initialMessagePageCount,
        },
    };
}

async function executeOperation(
    operation: InstagramGraphqlOperationName | 'IGDMessageListOffMsysQuery',
    input: Record<string, unknown>,
): Promise<unknown> {
    const tokens = await harvestTokens();
    return graphql(
        operation === 'IGDMessageListOffMsysQuery'
            ? olderMessagesRequest(input)
            : operationRequest(operation, input, tokens),
        tokens,
    );
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

async function getReelMedia(value: unknown) {
    return loadReelMedia(value, fetchReelInfo, userId =>
        executeOperation('PolarisUserHoverCardContentV2Query', { userId })
    );
}

function validateReelCommentsPayload(value: unknown): ReelCommentsPayload {
    if (!isRecord(value)) throw new Error('Invalid Instagram reel comments payload');
    if (Object.keys(value).some(key => key !== 'mediaId' && key !== 'cursor'))
        throw new Error('Invalid Instagram reel comments payload fields');
    if (typeof value.mediaId !== 'string' || !/^\d{1,64}$/.test(value.mediaId))
        throw new Error('Invalid Instagram reel media ID');
    if (value.cursor !== undefined && (typeof value.cursor !== 'string' || !value.cursor))
        throw new Error('Invalid Instagram reel comments cursor');
    return value as ReelCommentsPayload;
}

async function getReelComments(value: unknown) {
    const payload = validateReelCommentsPayload(value);
    const query = new URLSearchParams({ can_support_threading: 'true' });
    if (payload.cursor) {
        // `next_min_id` is an opaque structured string. The captured pagination
        // request sends it back unchanged rather than decoding its fields.
        query.set('min_id', payload.cursor);
        query.set('sort_order', 'popular');
    } else {
        query.set('permalink_enabled', 'false');
    }
    const response = await fetch(
        `https://www.instagram.com/api/v1/media/${payload.mediaId}/comments/?${query}`,
        {
            credentials: 'include',
            headers: {
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '359341',
            },
        },
    );
    if (!response.ok)
        throw new Error(`Instagram reel comments failed with ${response.status}`);
    return parseReelCommentsResponse(await response.json());
}

function numericId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^\d{1,64}$/.test(value))
        throw new Error(`Invalid Instagram ${label}`);
    return value;
}

function optionalOpaqueCursor(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value || value.length > 4_096)
        throw new Error('Invalid Instagram comment replies cursor');
    return value;
}

async function instagramRest(
    path: string,
    method: 'GET' | 'POST',
    body?: URLSearchParams,
): Promise<unknown> {
    const tokens = await harvestTokens();
    if (body) {
        body.set('jazoest', tokens.jazoest);
        body.set('fb_dtsg', tokens.fbDtsg);
    }
    const response = await fetch(`https://www.instagram.com${path}`, {
        method,
        credentials: 'include',
        headers: {
            ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '359341',
            'x-csrftoken': tokens.csrfToken,
            'x-requested-with': 'XMLHttpRequest',
        },
        ...(body ? { body } : {}),
    });
    if (!response.ok) throw new Error(`Instagram comment request failed with ${response.status}`);
    try {
        return await response.json();
    } catch {
        throw new Error('Instagram comment request returned an invalid response');
    }
}

async function getReelCommentReplies(value: unknown) {
    if (!isRecord(value)) throw new Error('Invalid Instagram comment replies payload');
    if (Object.keys(value).some(key => !['mediaId', 'commentId', 'cursor'].includes(key)))
        throw new Error('Invalid Instagram comment replies payload fields');
    const payload: ReelRepliesPayload = {
        mediaId: numericId(value.mediaId, 'reel media ID'),
        commentId: numericId(value.commentId, 'comment ID'),
        cursor: optionalOpaqueCursor(value.cursor),
    };
    const json = await instagramRest(
        buildReelCommentRepliesPath(payload),
        'GET',
    );
    return parseReelCommentRepliesResponse(json, payload.commentId);
}

async function createReelComment(value: unknown) {
    if (!isRecord(value)) throw new Error('Invalid Instagram create comment payload');
    if (Object.keys(value).some(key => !['mediaId', 'text', 'replyToCommentId'].includes(key)))
        throw new Error('Invalid Instagram create comment payload fields');
    const payload: CreateReelCommentPayload = {
        mediaId: numericId(value.mediaId, 'reel media ID'),
        text: typeof value.text === 'string' ? value.text.trim() : '',
        ...(value.replyToCommentId === undefined ? {} : {
            replyToCommentId: numericId(value.replyToCommentId, 'reply comment ID'),
        }),
    };
    if (!payload.text || payload.text.length > 2_200)
        throw new Error('Instagram comment must contain 1–2200 characters');
    const body = new URLSearchParams({ comment_text: payload.text });
    if (payload.replyToCommentId) body.set('replied_to_comment_id', payload.replyToCommentId);
    const json = await instagramRest(
        `/api/v1/web/comments/${payload.mediaId}/add/`,
        'POST',
        body,
    );
    return parseCreatedReelCommentResponse(json, payload.replyToCommentId);
}

let commentMutationId = 0;
async function setReelCommentLiked(value: unknown) {
    if (!isRecord(value)) throw new Error('Invalid Instagram comment like payload');
    if (Object.keys(value).some(key => !['commentId', 'liked'].includes(key)))
        throw new Error('Invalid Instagram comment like payload fields');
    const payload: ReelCommentLikePayload = {
        commentId: numericId(value.commentId, 'comment ID'),
        liked: value.liked === true,
    };
    if (typeof value.liked !== 'boolean') throw new Error('Invalid Instagram comment liked state');
    if (payload.liked) {
        const json = await executeOperation('PolarisCommentActionsLikeMutation', {
            commentId: payload.commentId,
            clientMutationId: String(++commentMutationId),
        });
        parseReelCommentLikeResponse(json);
    } else {
        const json = await instagramRest(
            `/api/v1/web/comments/unlike/${payload.commentId}/`,
            'POST',
            new URLSearchParams(),
        );
        if (!isRecord(json) || json.status !== 'ok')
            throw new Error('Instagram comment unlike receipt was not returned');
    }
    return { commentId: payload.commentId, hasLiked: payload.liked };
}

export default defineContentScript({
    matches: ['https://www.instagram.com/*'],
    runAt: 'document_idle',
    async main() {
        // Keep webext-bridge out of top-level imports: WXT evaluates this module
        // during build with a fake browser that does not implement runtime.onConnect.
        const { onMessage } = await import('webext-bridge/content-script');
        startAuthProbeListener();

        const handlers = {
            ...createInstagramRpcHandlers(executeOperation, {
                viewerId: async () => (await harvestTokens()).viewerId,
            }),
            getReelMedia,
            getReelComments,
            getReelCommentReplies,
            createReelComment,
            setReelCommentLiked,
        };
        for (const name of REMOTE_RPC_NAMES) {
            const handler = handlers[name] as (payload: unknown) => Promise<unknown>;
            onMessage(name, async ({ data }) => {
                try {
                    return ok(await handler(data));
                } catch (error) {
                    return fail(error);
                }
            });
        }
        if (import.meta.env.WXT_SOLID_PREVIEW === '1') {
            // SAFETY: createInstagramRpcHandlers gives getInbox the Page<Thread> contract; only the generic handler map widens it.
            const getInbox = () => handlers.getInbox({}) as Promise<import('../lib/domain').Page<import('../lib/domain').Thread>>;
            registerInboxProvider(getInbox, browser.runtime);
        }
    },
});
