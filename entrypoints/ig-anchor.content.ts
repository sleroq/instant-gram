import '../lib/bridge';
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
    INSTAGRAM_GRAPHQL_OPERATIONS,
    type InstagramGraphqlDescriptor,
    type InstagramGraphqlOperationName,
} from '../lib/instagram-api/catalog';
import { createInstagramRpcHandlers } from '../lib/instagram-api/handlers';
import {
    parseReelInfoResponse,
    parseReelMediaResponse,
} from '../lib/instagram-api/parsers';
import type { Result, RpcMap } from '../lib/domain';

type ReelPayload = Parameters<RpcMap['getReelMedia']>[0];
type RemoteRpcName = Exclude<keyof RpcMap, 'getPins' | 'togglePin'>;
const REMOTE_RPC_NAMES = [
    'getInbox',
    'getThread',
    'getReelMedia',
    'sendText',
    'setReaction',
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

function validateReelPayload(value: unknown): ReelPayload {
    if (!isRecord(value)) throw new Error('Invalid Instagram reel payload');
    if (Object.keys(value).some(key => key !== 'shortcode' && key !== 'mediaId'))
        throw new Error('Invalid Instagram reel payload fields');
    if (
        typeof value.shortcode !== 'string' ||
        value.shortcode.trim().length === 0 ||
        value.shortcode.length > 128
    )
        throw new Error('Invalid Instagram reel shortcode');
    if (
        value.mediaId !== undefined &&
        (typeof value.mediaId !== 'string' ||
            !/^\d{1,64}$/.test(value.mediaId))
    )
        throw new Error('Invalid Instagram reel media ID');
    return value as ReelPayload;
}

function reelMediaRequest(payload: ReelPayload): GraphqlRequest {
    return {
        friendlyName: FRIENDLY_NAMES.reelMedia,
        docId: DOC_IDS.reelMedia,
        endpoint: '/graphql/query',
        kind: 'query',
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

async function getReelMedia(value: unknown) {
    const payload = validateReelPayload(value);
    if (payload.mediaId)
        return parseReelInfoResponse(await fetchReelInfo(payload.mediaId), payload);
    const parsed = parseReelMediaResponse(
        await graphql(reelMediaRequest(payload)),
        payload,
    );
    return 'mediaId' in parsed
        ? parseReelInfoResponse(await fetchReelInfo(parsed.mediaId), payload)
        : parsed;
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
    },
});
