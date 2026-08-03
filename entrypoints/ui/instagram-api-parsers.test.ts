import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseInboxResponse,
    parseMarkThreadReadResponse,
    parseMarkThreadReadValidationResponse,
    parseMessage,
    parseMessageActionsResponse,
    parseMessageRequestsResponse,
    parsePinnedMessageResponse,
    parseReactionMutationResponse,
    parseSentCutoutStickerResponse,
    parseSentTextResponse,
    parseSecondaryGraphqlResponse,
    parseThreadInfoResponses,
    parseThreadResponse,
    parseUnreadCountResponses,
} from '../../lib/instagram-api/parsers.ts';

const user = {
    interop_messaging_user_fbid: 'sender-1',
    username: 'alice',
    full_name: 'Alice',
    profile_pic_url: 'https://cdn.example/avatar.jpg',
};

test('current inbox aliases normalize thread flags, folders, and server pins', () => {
    const page = parseInboxResponse({
        data: {
            fetch__SlideMailbox: {
                threads_by_folder: {
                    edges: [
                        {
                            node: {
                                as_ig_direct_thread: {
                                    thread_key: 'person-1',
                                    thread_fbid: 'thread-1',
                                    thread_igid: 'igid-1',
                                    thread_id: 'read-receipt-1',
                                    thread_title: 'Current thread',
                                    is_group: true,
                                    is_muted: true,
                                    messaging_folder_tag: 'PENDING',
                                    system_folder: 'INBOX',
                                    folder: 'PRIMARY',
                                    is_pin: true,
                                    users: [user],
                                    last_activity_timestamp_ms: '1785763880444',
                                },
                            },
                        },
                    ],
                    page_info: {
                        end_cursor: 'next-page',
                        has_next_page: true,
                    },
                },
            },
        },
    });

    assert.deepEqual(page, {
        items: [
            {
                key: 'person-1',
                threadFbid: 'thread-1',
                threadIgId: 'read-receipt-1',
                title: 'Current thread',
                isGroup: true,
                isMuted: true,
                folder: 'REQUESTS',
                lastActivityMs: 1_785_763_880_444,
                serverIsPin: true,
                serverPinnedMessageIds: [],
                users: [
                    {
                        id: 'sender-1',
                        username: 'alice',
                        fullName: 'Alice',
                        picUrl: 'https://cdn.example/avatar.jpg',
                    },
                ],
                lastMessage: undefined,
                cursor: 'thread-1',
            },
        ],
        cursor: 'next-page',
        hasNextPage: true,
    });
});

test('thread parsing keeps images, reactions, structured fallbacks, and pin state', () => {
    const response = parseThreadResponse(
        {
            data: {
                get_slide_thread_nullable: {
                    as_ig_direct_thread: {
                        thread_key: 'person-1',
                        thread_fbid: 'thread-1',
                        thread_title: 'Alice',
                        is_group: false,
                        system_folder: 'INBOX',
                        users: [user],
                        viewer: {
                            interop_messaging_user_fbid: 'viewer-1',
                        },
                        pinned_messages: [{ message_id: 'image-1' }],
                        slide_messages: {
                            edges: [
                                {
                                    node: {
                                        message_id: 'image-1',
                                        sender_fbid: 'sender-1',
                                        timestamp_ms: '2000',
                                        content_type: 'IMAGES',
                                        is_pinned: true,
                                        reactions: [
                                            {
                                                sender_fbid: 'viewer-1',
                                                reaction: '❤',
                                            },
                                        ],
                                        content: {
                                            attachments: [
                                                {
                                                    attachment_cdn_url:
                                                        'https://cdn.example/full.jpg',
                                                    preview_cdn_url:
                                                        'https://cdn.example/preview.jpg',
                                                    preview_width: 430,
                                                    preview_height: 960,
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    node: {
                                        message_id: 'reaction-log',
                                        timestamp_ms: '1500',
                                        content_type: 'REACTION_LOG_XMAT',
                                    },
                                },
                                {
                                    node: {
                                        message_id: 'ai-1',
                                        sender_fbid: 'ai-1',
                                        timestamp_ms: '1000',
                                        content_type: 'GEN_AI_RICH_RESPONSE_XMA',
                                        text_body: 'A concise answer',
                                        reactions: [],
                                        content: {
                                            unified_response: '{"type":"text"}',
                                        },
                                    },
                                },
                            ],
                            page_info: {
                                end_cursor: 'older',
                                has_next_page: true,
                            },
                        },
                    },
                },
            },
        },
        'fallback-viewer',
    );

    assert.equal(response.viewerId, 'viewer-1');
    assert.deepEqual(
        response.items.map(message => message.id),
        ['ai-1', 'image-1'],
    );
    assert.equal(response.thread?.serverPinnedMessageIds?.[0], 'image-1');

    const image = response.items[1];
    assert.equal(image.kind, 'image');
    if (image.kind !== 'image') return;
    assert.deepEqual(image.images, [
        {
            url: 'https://cdn.example/full.jpg',
            previewUrl: 'https://cdn.example/preview.jpg',
            width: 430,
            height: 960,
        },
    ]);
    assert.deepEqual(image.reactions, [
        { senderId: 'viewer-1', reaction: '❤', timestampMs: undefined },
    ]);
    assert.equal(image.isPinned, true);

    const fallback = response.items[0];
    assert.equal(fallback.kind, 'unsupported');
    if (fallback.kind === 'unsupported')
        assert.deepEqual(fallback.fallback, {
            label: 'Meta AI response',
            preview: 'A concise answer',
            targetUrl: undefined,
            thumbUrl: undefined,
        });
});

test('old aliases and admin XMA text remain supported', () => {
    const message = parseMessage({
        item_id: 'activity-1',
        sender_id: 'sender-1',
        timestamp: 1_700_000_000,
        content_type: 'REMOVE_PARTICIPANT_XMAT',
        content: {
            text_fragments: [
                { plaintext: 'Alice ' },
                { plaintext: 'removed Bob' },
            ],
        },
    });
    assert.equal(message?.kind, 'unsupported');
    if (message?.kind === 'unsupported')
        assert.equal(message.fallback.label, 'Alice removed Bob');
});

test('thread info independently preserves divergent UI, operation, and read-receipt identifiers', () => {
    const response = (thread: Record<string, unknown>) => ({
        data: {
            get_slide_thread_nullable: { as_ig_direct_thread: thread },
        },
    });
    const info = parseThreadInfoResponses(
        response({
            thread_key: 'stable-ui-key',
            thread_igid: 'operation-thread-fbid',
            thread_id: 'read-receipt-thread-id',
            thread_title: 'Alice',
        }),
        response({
            thread_key: 'stable-ui-key',
            thread_igid: 'secondary-operation-id',
            thread_id: 'secondary-read-receipt-id',
        }),
    );
    assert.equal(info.key, 'stable-ui-key');
    assert.equal(info.threadFbid, 'operation-thread-fbid');
    assert.equal(info.threadIgId, 'read-receipt-thread-id');
});

test('composer responses parse operation-specific emoji, sticker, music, avatar, and thread ID data', () => {
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDEmojiPickerQuery', {
            data: { emoji_categories: { nodes: [{
                id: 'faces', localized_name: 'Faces',
                emojis_in_category: [{ codepoint: [128512] }],
            }] } },
        }),
        { operation: 'IGDEmojiPickerQuery', categories: [{ id: 'faces', name: 'Faces', items: ['😀'] }] },
    );
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDComposerRichContentStickersV2_cutoutStickersQuery', {
            data: { xig_igd_stickers_query: { sections: { edges: [{ node: {
                id: 'cutout', title: 'Your Stickers', stickers: { edges: [{ node: {
                    id: 'sticker-1', alt_text: 'Wave', sticker_send_type: 'CUTOUT',
                    animated_info: { webp: { url: 'https://cdn.example/sticker.webp', width: 200, height: 300 } },
                } }] },
            } }] } } },
        }),
        { operation: 'IGDComposerRichContentStickersV2_cutoutStickersQuery', sections: [{
            id: 'cutout', title: 'Your Stickers', type: undefined, items: [{
                id: 'sticker-1', altText: 'Wave', sendType: 'CUTOUT',
                image: { url: 'https://cdn.example/sticker.webp', width: 200, height: 300, animated: true },
            }],
        }] },
    );
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDComposerRichContentMusicQuery', {
            data: { xfb_ig_audio_playlist_connection: { items: {
                edges: [{ node: { track: {
                    id: 'track-1', title: 'Title', display_artist: 'Artist', duration_in_ms: 1234,
                } } }],
                page_info: { end_cursor: 'next', has_next_page: true },
            } } },
        }),
        {
            operation: 'IGDComposerRichContentMusicQuery',
            tracks: [{ id: 'track-1', title: 'Title', artist: 'Artist', durationMs: 1234, artworkUrl: undefined, previewUrl: undefined }],
            cursor: 'next', hasNextPage: true,
        },
    );
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDComposerRichContentTray_AvatarAvailableQuery', {
            data: { fetch__IGUser: { user_avatar: null } },
        }),
        { operation: 'IGDComposerRichContentTray_AvatarAvailableQuery', available: false },
    );
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDComposerRichContentStickersV2ThreadIGIDQuery', {
            data: { get_slide_thread_nullable: { as_ig_direct_thread: {
                id: 'sticker-operation-id',
                thread_id: 'sticker-read-receipt-id',
            } } },
        }),
        { operation: 'IGDComposerRichContentStickersV2ThreadIGIDQuery', threadFbid: 'sticker-operation-id' },
    );
    assert.deepEqual(
        parseSecondaryGraphqlResponse('IGDComposerRichContentMusicThreadIGIDQuery', {
            data: { get_slide_thread_nullable: { as_ig_direct_thread: {
                id: 'music-operation-id',
                thread_key: 'music-ui-key',
            } } },
        }),
        { operation: 'IGDComposerRichContentMusicThreadIGIDQuery', threadFbid: 'music-operation-id' },
    );
});

test('request pages, actions, counts, and mutation receipts parse captured shapes', () => {
    const requestResponse = {
        data: {
            get_slide_mailbox_for_iris_subscription: {
                threads_by_folder: {
                    edges: [
                        {
                            node: {
                                as_ig_direct_thread: {
                                    id: 'request-1',
                                    marked_as_unread: true,
                                },
                            },
                        },
                    ],
                    page_info: { has_next_page: false },
                },
            },
            spamMailbox: {
                threads_by_folder: {
                    edges: [
                        {
                            node: {
                                as_ig_direct_thread: {
                                    id: 'spam-1',
                                    marked_as_unread: true,
                                    system_folder: 'JUNK',
                                },
                            },
                        },
                    ],
                    page_info: { has_next_page: false },
                },
            },
        },
    };
    assert.equal(
        parseMessageRequestsResponse(requestResponse, 'SPAM').items[0]?.folder,
        'REQUESTS',
    );
    assert.deepEqual(parseUnreadCountResponses(requestResponse, requestResponse), {
        countedTotal: 3,
        inbox: { count: 1, hasMore: false },
        requests: { count: 1, hasMore: false },
        spam: { count: 1, hasMore: false },
    });

    assert.deepEqual(
        parseMessageActionsResponse({
            data: {
                get_slide_thread_nullable: {
                    as_ig_direct_thread: {
                        viewer: {
                            interop_messaging_user_fbid: 'viewer-1',
                        },
                        reachability_status: 'REACHABLE',
                        pinned_messages: [{ message_id: 'message-1' }],
                    },
                },
                get_slide_message: {
                    message_id: 'message-1',
                    sender_fbid: 'viewer-1',
                    content_type: 'TEXT',
                    is_pinned: true,
                },
            },
        }),
        {
            canCopy: true,
            canReply: true,
            canReact: true,
            canUnsend: true,
            canPin: true,
            isPinned: true,
        },
    );

    assert.deepEqual(
        parseSentTextResponse({
            data: {
                xig_direct_text_send_with_slide_messaging_response: {
                    message_id: 'sent-1',
                    timestamp_ms: '1785763880444',
                },
            },
        }, '7001'),
        { messageId: 'sent-1', timestampMs: 1_785_763_880_444, clientRequestId: '7001' },
    );
    assert.deepEqual(
        parseSentCutoutStickerResponse({
            data: {
                ig_direct_cutout_sticker_share_with_slide_msg_response: {
                    message_id: 'sticker-1',
                },
            },
        }, '7002'),
        { messageId: 'sticker-1', timestampMs: undefined, clientRequestId: '7002' },
    );
    assert.deepEqual(
        parsePinnedMessageResponse({
            data: {
                xig_direct_pin_message: {
                    pinned_messages: [
                        { message_id: 'message-1' },
                        { id: 'message-2' },
                    ],
                },
            },
        }),
        { pinnedMessageIds: ['message-1', 'message-2'] },
    );
    assert.deepEqual(
        parseReactionMutationResponse({
            data: {
                xig_direct_reaction_send_with_slide_messaging_response: {
                    slide_message: { id: 'message-1' },
                },
            },
        }),
        { success: true },
    );
    assert.deepEqual(
        parseMarkThreadReadResponse({
            data: {
                xig_direct_item_seen_mutation_with_slide_messaging_response: {
                    participant_fbid: 'viewer-1',
                },
            },
        }),
        { success: true },
    );
    assert.deepEqual(
        parseMarkThreadReadValidationResponse({
            data: { xig_direct_mark_read_id_validation: false },
        }),
        { success: true },
    );
});
