import type { JsonObject } from '../json.ts';

export type InstagramGraphqlContext = {
    deviceId: string;
};

export type InstagramGraphqlDescriptor<Input> = {
    friendlyName: string;
    docId: string;
    endpoint: '/api/graphql';
    buildVariables: (
        input: Input,
        context: InstagramGraphqlContext,
    ) => JsonObject;
};

function query<Input>(
    friendlyName: string,
    docId: string,
    buildVariables: InstagramGraphqlDescriptor<Input>['buildVariables'],
): InstagramGraphqlDescriptor<Input> {
    return {
        friendlyName,
        docId,
        endpoint: '/api/graphql',
        buildVariables,
    };
}

const listFlags = {
    __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
    __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true,
};
const threadFlags = {
    __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false,
    __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
};
export const INSTAGRAM_GRAPHQL_OPERATIONS = {
    PolarisDirectInboxQuery: query(
        'PolarisDirectInboxQuery',
        '27832650746344714',
        (_input: JsonObject, context) => ({
            device_id_for_iris_subscription: context.deviceId,
            __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
            ...listFlags,
        }),
    ),
    IGDThreadListOffMsysPaginationQuery: query(
        'IGDThreadListOffMsysPaginationQuery',
        '28035404249479587',
        (input: { cursor: string; mailboxId: string }) => ({
            count: 5,
            cursor: input.cursor,
            folder: 'INBOX',
            newer_than_timestamp_ms: null,
            id: input.mailboxId,
            ...listFlags,
        }),
    ),
    IGDThreadDetailQuery: query(
        'IGDThreadDetailQuery',
        '28053520164245408',
        (input: { threadKey: string }) => ({
            thread_fbid: input.threadKey,
            ...threadFlags,
        }),
    ),
    IGDMessageListOffMsysQuery: query(
        'IGDMessageListOffMsysQuery',
        '25255103937520139',
        (input: { threadKey: string; cursor: string }) => ({
            after: input.cursor,
            before: null,
            first: 20,
            last: null,
            newer_than_message_id: null,
            older_than_message_id: null,
            id: input.threadKey,
            __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: 20,
        }),
    ),
};
