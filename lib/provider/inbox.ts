import { Context, Deferred, Effect, Exit, Layer, Schema } from 'effect';
import type { Page, Thread, ThreadMessages } from '../domain.ts';
import type { JsonValue } from '../json.ts';
import { InboxError } from '../engine/resources.ts';
import {
    PROVIDER_PORT,
    type ProviderRequest,
    type ProviderResponse,
} from './protocol.ts';

export type ProviderPort = {
    name: string;
    sender?: {
        id?: string;
        frameId?: number;
        url?: string;
        tab?: { id?: number };
    };
    onMessage: {
        addListener(listener: (message: ProviderResponseInput) => void): void;
        removeListener(
            listener: (message: ProviderResponseInput) => void,
        ): void;
    };
    onDisconnect: {
        addListener(listener: () => void): void;
        removeListener(listener: () => void): void;
    };
    postMessage(message: ProviderRequest): void;
    disconnect(): void;
};

export type ProviderResponseInput = JsonValue;

export type InboxProviderError = InboxError;
export interface InboxProviderEffects {
    readonly accept: (port: ProviderPort) => void;
    readonly account: Effect.Effect<string, InboxProviderError>;
    readonly inbox: (
        expectedAccountId: string,
        cursor?: string,
    ) => Effect.Effect<Page<Thread>, InboxProviderError>;
    readonly history: (
        expectedAccountId: string,
        threadKey: string,
        cursor?: string,
    ) => Effect.Effect<ThreadMessages, InboxProviderError>;
}

export class InboxProviderService extends Context.Service<
    InboxProviderService,
    InboxProviderEffects
>()('icr/InboxProvider') {}

type Pending = {
    method: ProviderRequest['method'];
    succeed(value: string | Page<Thread> | ThreadMessages): void;
    fail(error: InboxProviderError): void;
};
type Connection = {
    port: ProviderPort;
    pending: Map<number, Pending>;
    removeListeners(): void;
};

const ResponseHeader = Schema.Struct({
    kind: Schema.Literal('response'),
    id: Schema.Int,
    method: Schema.Literals(['account', 'inbox', 'history']),
    result: Schema.Unknown,
});
const ErrorResult = Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({
        kind: Schema.Literals([
            'auth',
            'provider_unavailable',
            'protocol',
            'storage',
            'no_progress',
            'capacity',
        ]),
        message: Schema.String,
    }),
});
const AccountResult = Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.NonEmptyString,
});
const UserValue = Schema.Struct({
    id: Schema.String,
    username: Schema.String,
    fullName: Schema.String,
    picUrl: Schema.NullOr(Schema.String),
});
const MessageReactionValue = Schema.Struct({
    senderId: Schema.String,
    reaction: Schema.String,
    timestampMs: Schema.optional(Schema.Finite),
});
const MessageImageValue = Schema.Struct({
    url: Schema.String,
    previewUrl: Schema.optional(Schema.String),
    width: Schema.optional(Schema.Finite),
    height: Schema.optional(Schema.Finite),
});
const MessageFallbackValue = Schema.Struct({
    label: Schema.String,
    preview: Schema.optional(Schema.String),
    targetUrl: Schema.optional(Schema.String),
    thumbUrl: Schema.optional(Schema.String),
});
const ReplyPreviewValue = Schema.Union([
    Schema.Struct({ kind: Schema.Literal('text'), text: Schema.String }),
    Schema.Struct({
        kind: Schema.Literal('media'),
        title: Schema.String,
        thumbUrl: Schema.optional(Schema.String),
        subtitle: Schema.optional(Schema.String),
    }),
    Schema.Struct({
        kind: Schema.Literal('unavailable'),
        label: Schema.String,
    }),
]);
const messageMetadataFields = {
    id: Schema.String,
    isSyntheticId: Schema.optional(Schema.Literal(true)),
    ts: Schema.Finite,
    reactions: Schema.optional(
        Schema.mutable(Schema.Array(MessageReactionValue)),
    ),
    isPinned: Schema.optional(Schema.Boolean),
};
const sentMessageFields = {
    senderId: Schema.String,
    repliedTo: Schema.optional(Schema.String),
    replyPreview: Schema.optional(ReplyPreviewValue),
};
const MessageValue = Schema.Union([
    Schema.Struct({
        ...messageMetadataFields,
        ...sentMessageFields,
        kind: Schema.Literal('text'),
        text: Schema.String,
    }),
    Schema.Struct({
        ...messageMetadataFields,
        kind: Schema.Literal('reaction_log'),
        fragment: Schema.String,
    }),
    Schema.Struct({
        ...messageMetadataFields,
        kind: Schema.Literal('activity'),
        text: Schema.String,
    }),
    Schema.Struct({
        ...messageMetadataFields,
        ...sentMessageFields,
        kind: Schema.Literal('reel_share'),
        mediaType: Schema.Literals(['reel', 'post']),
        shortcode: Schema.String,
        mediaId: Schema.optional(Schema.String),
        targetUrl: Schema.String,
        thumbUrl: Schema.String,
        previewWidth: Schema.optional(Schema.Finite),
        previewHeight: Schema.optional(Schema.Finite),
        author: Schema.String,
        caption: Schema.optional(Schema.String),
    }),
    Schema.Struct({
        ...messageMetadataFields,
        ...sentMessageFields,
        kind: Schema.Literal('inline_share'),
        targetUrl: Schema.optional(Schema.String),
        thumbUrl: Schema.String,
        title: Schema.String,
        subtitle: Schema.optional(Schema.String),
    }),
    Schema.Struct({
        ...messageMetadataFields,
        ...sentMessageFields,
        kind: Schema.Literal('image'),
        images: Schema.mutable(Schema.Array(MessageImageValue)),
    }),
    Schema.Struct({
        ...messageMetadataFields,
        ...sentMessageFields,
        kind: Schema.Literal('unsupported'),
        contentType: Schema.String,
        fallback: MessageFallbackValue,
    }),
]);
const ThreadValue = Schema.Struct({
    key: Schema.String,
    threadFbid: Schema.optional(Schema.String),
    threadIgId: Schema.optional(Schema.String),
    title: Schema.String,
    isGroup: Schema.Boolean,
    isMuted: Schema.Boolean,
    folder: Schema.Literals(['PRIMARY', 'GENERAL', 'REQUESTS']),
    lastActivityMs: Schema.Finite,
    isUnread: Schema.Boolean,
    serverIsPin: Schema.Boolean,
    serverPinnedMessageIds: Schema.optional(
        Schema.mutable(Schema.Array(Schema.String)),
    ),
    users: Schema.mutable(Schema.Array(UserValue)),
    lastMessage: Schema.optional(MessageValue),
    cursor: Schema.optional(Schema.String),
});
const InboxResult = Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
        items: Schema.mutable(Schema.Array(ThreadValue)),
        hasNextPage: Schema.Boolean,
        cursor: Schema.optional(Schema.String),
    }),
});
const HistoryResult = Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
        items: Schema.mutable(Schema.Array(MessageValue)),
        hasNextPage: Schema.Boolean,
        cursor: Schema.optional(Schema.String),
        viewerId: Schema.NonEmptyString,
        thread: Schema.optional(ThreadValue),
    }),
});
type ResponseHeader = typeof ResponseHeader.Type;
type ProviderResultInput = ResponseHeader['result'];

function responseHeader(
    value: ProviderResponseInput,
): ResponseHeader | undefined {
    const exit = Schema.decodeUnknownExit(ResponseHeader)(value);
    return Exit.isSuccess(exit) ? exit.value : undefined;
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    value: ProviderResultInput,
): S['Type'] | undefined {
    const exit = Schema.decodeUnknownExit(schema)(value);
    return Exit.isSuccess(exit) ? exit.value : undefined;
}

function providerResponse(
    header: ResponseHeader,
): ProviderResponse | undefined {
    const failure = decode(ErrorResult, header.result);
    if (failure) {
        if (header.method === 'account')
            return {
                kind: 'response',
                id: header.id,
                method: 'account',
                result: failure,
            };
        if (header.method === 'inbox')
            return {
                kind: 'response',
                id: header.id,
                method: 'inbox',
                result: failure,
            };
        return {
            kind: 'response',
            id: header.id,
            method: 'history',
            result: failure,
        };
    }

    if (header.method === 'account') {
        const result = decode(AccountResult, header.result);
        return (
            result && {
                kind: 'response',
                id: header.id,
                method: 'account',
                result,
            }
        );
    }

    if (header.method === 'inbox') {
        const result = decode(InboxResult, header.result);
        if (!result) return;
        return {
            kind: 'response',
            id: header.id,
            method: 'inbox',
            result,
        };
    }

    const result = decode(HistoryResult, header.result);
    if (!result) return;
    return {
        kind: 'response',
        id: header.id,
        method: 'history',
        result,
    };
}

export function makeInboxProvider(options: {
    ensureAnchor(
        hasReadyConnection: (tabId: number) => boolean,
    ): Promise<number>;
    extensionId: string;
}): InboxProviderEffects & { dispose(): void } {
    let closed = false;
    const closure = Deferred.makeUnsafe<never, InboxProviderError>();
    type AnchorFlight = { promise: Promise<number>; waiters: number };
    let anchorFlight: AnchorFlight | undefined;
    const ensureAnchor = Effect.acquireUseRelease(
        Effect.sync(() => {
            if (!anchorFlight) {
                const flight: AnchorFlight = {
                    promise: Promise.resolve().then(() =>
                        options.ensureAnchor((tabId) => connections.has(tabId)),
                    ),
                    waiters: 0,
                };
                flight.promise = flight.promise.then(
                    (tabId) => {
                        if (anchorFlight === flight) anchorFlight = undefined;
                        return tabId;
                    },
                    (cause: unknown) => {
                        if (anchorFlight === flight) anchorFlight = undefined;
                        throw cause;
                    },
                );
                anchorFlight = flight;
            }
            anchorFlight.waiters++;
            return anchorFlight;
        }),
        (flight) =>
            Effect.tryPromise({
                try: () => flight.promise,
                catch: unavailable,
            }),
        (flight) =>
            Effect.sync(() => {
                // Browser acquisition cannot be aborted; only its active owners expire.
                flight.waiters--;
                if (flight.waiters === 0 && anchorFlight === flight)
                    anchorFlight = undefined;
            }),
    );
    const connections = new Map<number, Connection>();
    const waiters = new Map<number, Set<() => void>>();
    let nextId = 0;
    function unavailable() {
        return new InboxError('provider_unavailable');
    }

    function retire(connection: Connection) {
        connection.removeListeners();
        for (const pending of connection.pending.values())
            pending.fail(unavailable());
        connection.pending.clear();
    }

    function accept(port: ProviderPort) {
        if (closed) {
            port.disconnect();
            return;
        }

        const tabId = port.sender?.tab?.id;
        const url = port.sender?.url ? new URL(port.sender.url) : undefined;
        if (
            port.name !== PROVIDER_PORT ||
            port.sender?.id !== options.extensionId ||
            port.sender?.frameId !== 0 ||
            !Number.isInteger(tabId) ||
            tabId === undefined ||
            url?.origin !== 'https://www.instagram.com'
        ) {
            port.disconnect();
            return;
        }

        const selectedTabId = tabId;
        const connection: Connection = {
            port,
            pending: new Map(),
            removeListeners: () => {
                port.onMessage.removeListener(onMessage);
                port.onDisconnect.removeListener(onDisconnect);
            },
        };
        const previous = connections.get(tabId);
        if (previous) {
            retire(previous);
            previous.port.disconnect();
        }
        function onMessage(value: ProviderResponseInput) {
            if (closed || connections.get(selectedTabId) !== connection) return;
            const header = responseHeader(value);
            if (!header) return;
            const pending = connection.pending.get(header.id);
            if (!pending || pending.method !== header.method) return;
            connection.pending.delete(header.id);
            const response = providerResponse(header);
            if (!response) {
                pending.fail(new InboxError('protocol'));
                return;
            }
            if (response.result.ok) pending.succeed(response.result.value);
            else pending.fail(new InboxError(response.result.error.kind));
        }
        function onDisconnect() {
            if (connections.get(selectedTabId) === connection)
                connections.delete(selectedTabId);
            retire(connection);
        }

        connections.set(tabId, connection);
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        for (const ready of waiters.get(tabId) ?? []) ready();
        waiters.delete(tabId);
    }

    const connection = Effect.fn('InboxProvider.connection')(function* () {
        if (closed) return yield* Effect.fail(unavailable());
        const tabId = yield* ensureAnchor;
        const existing = connections.get(tabId);
        if (existing) return existing;
        yield* Effect.callback<void, InboxProviderError>((resume) => {
            const set = waiters.get(tabId) ?? new Set<() => void>();
            function ready() {
                resume(Effect.void);
            }
            set.add(ready);
            waiters.set(tabId, set);
            return Effect.sync(() => {
                set.delete(ready);
                if (set.size === 0) waiters.delete(tabId);
            });
        });
        const connected = connections.get(tabId);
        return yield* connected
            ? Effect.succeed(connected)
            : Effect.fail(unavailable());
    });

    const request = Effect.fn('InboxProvider.request')(function* <A>(
        makeRequest: (id: number) => ProviderRequest,
    ): Effect.fn.Return<A, InboxProviderError> {
        if (closed) return yield* Effect.fail(unavailable());
        const request = makeRequest(++nextId);
        const connected = yield* Effect.raceFirst(
            connection(),
            Deferred.await(closure),
        ).pipe(
            Effect.timeoutOrElse({
                duration: '10 seconds',
                orElse: () => Effect.fail(unavailable()),
            }),
        );

        return yield* Effect.callback<A, InboxProviderError>((resume) => {
            if (closed || ![...connections.values()].includes(connected)) {
                resume(Effect.fail(unavailable()));
                return;
            }
            connected.pending.set(request.id, {
                method: request.method,
                succeed(value) {
                    // SAFETY: the response method is matched before this value is delivered.
                    resume(Effect.succeed(value as A));
                },
                fail: (error) => resume(Effect.fail(error)),
            });

            try {
                connected.port.postMessage(request);
            } catch {
                connected.pending.delete(request.id);
                resume(Effect.fail(unavailable()));
            }
            return Effect.sync(() => connected.pending.delete(request.id));
        }).pipe(
            Effect.timeoutOrElse({
                duration: '15 seconds',
                orElse: () => Effect.fail(unavailable()),
            }),
        );
    });

    return {
        dispose() {
            if (closed) return;
            closed = true;
            anchorFlight = undefined;
            Deferred.doneUnsafe(closure, Effect.fail(unavailable()));
            waiters.clear();
            for (const connection of connections.values()) {
                retire(connection);
                connection.port.disconnect();
            }
            connections.clear();
        },
        accept,
        account: request<string>((id) => ({
            kind: 'request',
            id,
            method: 'account',
        })),
        inbox: (expectedAccountId, cursor) =>
            request<Page<Thread>>((id) => ({
                kind: 'request',
                id,
                method: 'inbox',
                expectedAccountId,
                cursor,
            })),
        history: (expectedAccountId, threadKey, cursor) =>
            request<ThreadMessages>((id) => ({
                kind: 'request',
                id,
                method: 'history',
                expectedAccountId,
                threadKey,
                cursor,
            })),
    };
}

export function inboxProviderLive(options: {
    ensureAnchor(
        hasReadyConnection: (tabId: number) => boolean,
    ): Promise<number>;
    extensionId: string;
}) {
    return Layer.effect(
        InboxProviderService,
        Effect.map(
            Effect.acquireRelease(
                Effect.sync(() => makeInboxProvider(options)),
                (provider) => Effect.sync(() => provider.dispose()),
            ),
            InboxProviderService.of,
        ),
    );
}
