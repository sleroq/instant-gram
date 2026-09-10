import type { Page, Thread } from '../domain.ts';
import { harvestTokens } from '../ig-auth.ts';
import { INSTAGRAM_GRAPHQL_OPERATIONS } from './catalog.ts';
import { parseInboxResponse } from './parsers.ts';
import { parseJson, type JsonValue } from '../json.ts';

export async function fetchInbox(
    request: typeof fetch = fetch,
): Promise<Page<Thread>> {
    const tokens = await harvestTokens();
    const operation = INSTAGRAM_GRAPHQL_OPERATIONS.PolarisDirectInboxQuery;
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
        variables: JSON.stringify(
            operation.buildVariables(
                {},
                {
                    viewerId: tokens.viewerId,
                    deviceId: tokens.deviceId,
                },
            ),
        ),
        doc_id: operation.docId,
    });
    const response = await request(
        `https://www.instagram.com${operation.endpoint}`,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'x-ig-app-id': '936619743392459',
                'x-asbd-id': '359341',
                'x-fb-lsd': tokens.lsd,
                'x-fb-friendly-name': operation.friendlyName,
                'x-csrftoken': tokens.csrfToken,
            },
            body,
        },
    );
    if (!response.ok)
        throw new Error(
            `Instagram inbox request failed with status ${response.status}`,
        );
    let json: JsonValue;
    try {
        json = parseJson(await response.text());
    } catch {
        throw new Error('Instagram inbox returned an invalid response');
    }
    return parseInboxResponse(json);
}
