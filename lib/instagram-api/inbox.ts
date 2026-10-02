import type { Page, Thread, ThreadMessages } from '../domain.ts';
import { InboxError } from '../engine/resources.ts';
import {
    currentInstagramAccountId,
    harvestTokens,
    type Tokens,
} from '../ig-auth.ts';
import {
    isBoolean,
    isJsonObject,
    isString,
    parseJson,
    type JsonValue,
} from '../json.ts';
import {
    INSTAGRAM_GRAPHQL_OPERATIONS,
    type InstagramGraphqlDescriptor,
} from './catalog.ts';
import {
    parseInboxResponse,
    parseMailboxId,
    parseThreadResponse,
} from './parsers.ts';

function field(
    value: JsonValue | undefined,
    name: string,
): JsonValue | undefined {
    return isJsonObject(value) ? value[name] : undefined;
}

function requireConnection(value: JsonValue | undefined) {
    const edges = field(value, 'edges');
    const info = field(value, 'page_info');
    const more = field(info, 'has_next_page');
    const cursor = field(info, 'end_cursor');
    if (
        !Array.isArray(edges) ||
        !isBoolean(more) ||
        edges.some((edge) => !isJsonObject(field(edge, 'node'))) ||
        (more && (!isString(cursor) || !cursor))
    ) {
        throw new InboxError('protocol');
    }
}

function decodeInbox(json: JsonValue): Page<Thread> {
    const data = field(json, 'data');
    const mailbox =
        field(data, 'get_slide_mailbox_for_iris_subscription') ??
        field(data, 'fetch__SlideMailbox');
    const connection = field(mailbox, 'threads_by_folder');
    requireConnection(connection);
    const page = parseInboxResponse(json);
    const edges = field(connection, 'edges');
    if (Array.isArray(edges) && page.items.length !== edges.length)
        throw new InboxError('protocol');
    return page;
}

function decodeHistory(json: JsonValue, viewerId: string): ThreadMessages {
    const data = field(json, 'data');
    const wrapper =
        field(data, 'get_slide_thread_nullable') ??
        field(data, 'fetch__SlideThread');
    requireConnection(
        field(field(wrapper, 'as_ig_direct_thread'), 'slide_messages'),
    );
    return parseThreadResponse(json, viewerId);
}

/** Only these four captured read descriptors enter the production provider. */
export function createInboxReader(
    options: {
        request?: typeof fetch;
        tokens?: () => Promise<Tokens>;
        account?: () => string;
    } = {},
) {
    const request = options.request ?? fetch;
    const getTokens = options.tokens ?? harvestTokens;
    const account = options.account ?? currentInstagramAccountId;
    let mailboxAccount: string | undefined;
    let mailboxId: string | undefined;

    function verify(expected: string) {
        if (account() !== expected) throw new InboxError('auth');
    }

    async function graphql<Input>(
        operation: InstagramGraphqlDescriptor<Input>,
        input: Input,
        expected: string,
    ) {
        const tokens = await getTokens();
        verify(expected);

        const body = new URLSearchParams({
            __d: 'www',
            __a: '1',
            __comet_req: '7',
            dpr: '2',
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: operation.friendlyName,
            server_timestamps: 'true',
            fb_dtsg: tokens.fbDtsg,
            lsd: tokens.lsd,
            jazoest: tokens.jazoest,
            doc_id: operation.docId,
            variables: JSON.stringify(operation.buildVariables(input, tokens)),
        });
        const response = await request(
            `https://www.instagram.com${operation.endpoint}`,
            {
                method: 'POST',
                credentials: 'include',
                body,
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-ig-app-id': '936619743392459',
                    'x-asbd-id': '359341',
                    'x-fb-lsd': tokens.lsd,
                    'x-fb-friendly-name': operation.friendlyName,
                    'x-csrftoken': tokens.csrfToken,
                },
            },
        );
        verify(expected);
        if (response.status === 401 || response.status === 403)
            throw new InboxError('auth');
        if (!response.ok) throw new InboxError('protocol');

        const json = parseJson(await response.text());
        verify(expected);
        const errors = field(json, 'errors');
        if (
            errors !== undefined &&
            (!Array.isArray(errors) || errors.length > 0)
        )
            throw new InboxError('protocol');

        return { json, viewerId: tokens.viewerId };
    }

    async function inbox(cursor?: string): Promise<Page<Thread>> {
        const expected = account();
        if (mailboxAccount !== expected) {
            mailboxAccount = expected;
            mailboxId = undefined;
        }
        if (!cursor || !mailboxId) {
            const first = await graphql(
                INSTAGRAM_GRAPHQL_OPERATIONS.PolarisDirectInboxQuery,
                {},
                expected,
            );
            const page = decodeInbox(first.json);
            mailboxId = parseMailboxId(first.json);
            if (page.hasNextPage && !mailboxId)
                throw new InboxError('protocol');
            if (!cursor) return page;
        }
        if (!mailboxId) throw new InboxError('protocol');
        const result = await graphql(
            INSTAGRAM_GRAPHQL_OPERATIONS.IGDThreadListOffMsysPaginationQuery,
            {
                count: 5,
                cursor,
                folder: 'INBOX',
                newerThanTimestampMs: null,
                mailboxId,
            },
            expected,
        );
        return decodeInbox(result.json);
    }

    async function history(
        threadKey: string,
        cursor?: string,
    ): Promise<ThreadMessages> {
        const expected = account();
        const result = cursor
            ? await graphql(
                  INSTAGRAM_GRAPHQL_OPERATIONS.IGDMessageListOffMsysQuery,
                  { threadKey, cursor },
                  expected,
              )
            : await graphql(
                  INSTAGRAM_GRAPHQL_OPERATIONS.IGDThreadDetailQuery,
                  { threadKey },
                  expected,
              );
        return decodeHistory(result.json, result.viewerId);
    }
    return { inbox, history };
}
