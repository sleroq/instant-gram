import assert from 'node:assert/strict';
import test from 'node:test';
import {
    parseInboxResponse,
    parseMessage,
    parseThread,
    parseThreadResponse,
} from '../lib/instagram-api/parsers.ts';

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
                                    marked_as_unread: true,
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
                isUnread: true,
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

test('thread type follows explicit server flags, not the projected user count', () => {
    const thread = {
        thread_key: 'chat-type',
        users: [user, { ...user, interop_messaging_user_fbid: 'viewer-1' }],
    };
    assert.equal(parseThread({ ...thread, is_group: false })?.isGroup, false);
    assert.equal(
        parseThread({ ...thread, is_group_thread: true })?.isGroup,
        true,
    );
    assert.equal(
        parseThread({ ...thread, is_group: false, is_group_thread: true })
            ?.isGroup,
        false,
    );
});

test('thread unread state compares the latest incoming message with the viewer watermark', () => {
    const parsed = parseThread({
        thread_key: 'person-1',
        thread_id: 'read-receipt-1',
        viewer: { interop_messaging_user_fbid: 'viewer-fbid' },
        marked_as_unread: false,
        slide_read_receipts: [
            {
                participant_fbid: 'viewer-fbid',
                watermark_timestamp_ms: '1786269297000',
            },
        ],
        slide_messages: {
            edges: [
                {
                    node: {
                        id: 'latest-message',
                        sender_fbid: 'peer-fbid',
                        timestamp_ms: '1786269297434',
                        content_type: 'TEXT',
                        content: {
                            __typename: 'SlideMessageText',
                            text_body: 'new',
                        },
                    },
                },
            ],
        },
    });

    assert.equal(parsed?.isUnread, true);
});

test('thread FBID is retained independently from the stable UI key', () => {
    const parsed = parseThread({
        thread_key: 'route-key',
        thread_fbid: 'mutation-fbid',
        thread_igid: 'different-igid',
    });
    assert.equal(parsed?.key, 'route-key');
    assert.equal(parsed?.threadFbid, 'mutation-fbid');
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
                                        message_id: 'leading-reaction-log',
                                        content_type: 'REACTION_LOG_XMAT',
                                    },
                                },
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
                                        content_type:
                                            'GEN_AI_RICH_RESPONSE_XMA',
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
    assert.equal(response.thread?.lastMessage?.id, 'image-1');
    assert.deepEqual(
        response.items.map((message) => message.id),
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

test('old aliases and admin XMA text normalize as protocol-neutral activity', () => {
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
    assert.equal(message?.kind, 'activity');
    if (message?.kind === 'activity')
        assert.equal(message.text, 'Alice removed Bob');
});

test('HAR-evidenced message types have an explicit rich, activity, fallback, or suppressed policy', () => {
    const base = { sender_fbid: 'sender-1', timestamp_ms: '1783181919592' };
    const cases = [
        {
            type: 'TEXT',
            node: {
                content: {
                    text_fragments: [{ plaintext: 'fragment-only text' }],
                },
            },
            expected: 'text',
        },
        {
            type: 'IMAGES',
            node: {
                content: {
                    attachments: [
                        { preview_cdn_url: 'https://cdn.example/photo.jpg' },
                    ],
                },
            },
            expected: 'image',
        },
        {
            type: 'MESSAGE_INLINE_SHARE',
            node: {
                content: {
                    xma: {
                        __typename: 'SlideMessageStandardXMA',
                        title_text: 'Shared post',
                        subtitle_text: 'Post caption',
                        preview_image: { url: 'https://cdn.example/post.jpg' },
                    },
                },
            },
            expected: 'inline_share',
        },
        { type: 'REACTION_LOG_XMAT', node: {}, expected: undefined },
        {
            type: 'CHANGE_THREAD_IMAGE_XMAT',
            node: {
                content: {
                    text_fragments: [
                        { plaintext: 'Alice changed the group image.' },
                    ],
                },
            },
            expected: 'activity',
        },
        {
            type: 'CHANGE_THREAD_NAME_XMAT',
            node: {
                content: {
                    text_fragments: [
                        { plaintext: 'Alice named the group Friends.' },
                    ],
                },
            },
            expected: 'activity',
        },
        {
            type: 'MONTAGE_SHARE_XMA',
            node: { text_body: 'Story reply' },
            expected: 'unsupported',
        },
        {
            type: 'REMOVE_PARTICIPANT_XMAT',
            node: {
                content: {
                    text_fragments: [{ plaintext: 'Alice removed Bob' }],
                },
            },
            expected: 'activity',
        },
        {
            type: 'GEN_AI_RICH_RESPONSE_XMA',
            node: { text_body: 'AI answer' },
            expected: 'unsupported',
        },
        {
            type: 'GEN_AI_SEARCH_PLUGIN_RESPONSE_XMA',
            node: { text_body: 'Search answer' },
            expected: 'unsupported',
        },
        {
            type: 'IG_REELS_BLEND_VISITATION_XMAT',
            node: {},
            expected: 'unsupported',
        },
        {
            type: 'THREAD_IGD_NEW_FRIEND_BUMP_XMAT',
            node: {
                content: {
                    text_fragments: [
                        { plaintext: 'You can now message each other.' },
                    ],
                },
            },
            expected: 'activity',
        },
    ];

    for (const [index, item] of cases.entries()) {
        const message = parseMessage({
            ...base,
            message_id: `inventory-${index}`,
            content_type: item.type,
            ...item.node,
        });
        assert.equal(message?.kind, item.expected, item.type);
    }
});

test('inline-share aliases normalize detailed cards and incomplete media to friendly fallbacks', () => {
    const detailed = [
        {
            __typename: 'SlideMessagePortraitXMA',
            xmaHeaderTitle: 'Portrait author',
            caption_body_text: 'Portrait caption',
            xmaPreviewImage: { url: 'https://cdn.example/portrait.jpg' },
        },
        {
            __typename: 'SlideMessageStandardXMA',
            title_text: 'Standard post',
            subtitle_text: 'Standard subtitle',
            preview_image: { url: 'https://cdn.example/standard.jpg' },
        },
        {
            __typename: 'SlideMessageLayeredXMA',
            xmaTitle: 'Layered share',
            subtitle_text: 'Layered subtitle',
            preview_image: { url: 'https://cdn.example/layered.jpg' },
        },
    ];
    for (const [index, xma] of detailed.entries()) {
        const message = parseMessage({
            message_id: `share-${index}`,
            content_type: 'MESSAGE_INLINE_SHARE',
            content: { xma },
        });
        assert.equal(message?.kind, 'inline_share');
        if (message?.kind === 'inline_share') {
            assert.ok(message.title);
            assert.ok(message.thumbUrl);
        }
    }

    const incomplete = [
        { content: undefined, label: 'Shared post' },
        { content: {}, label: 'Shared post' },
        {
            content: {
                xma: {
                    __typename: 'SlideMessagePlaceholderXMA',
                    title_text: 'Message unavailable',
                    subtitle_text: 'This content is no longer available.',
                },
            },
            label: 'Message unavailable',
        },
        {
            content: {
                xma: {
                    title_text: 'Broken preview',
                    preview_image: { url: '' },
                },
            },
            label: 'Broken preview',
        },
    ];
    for (const [index, item] of incomplete.entries()) {
        const message = parseMessage({
            message_id: `incomplete-${index}`,
            content_type: 'MESSAGE_INLINE_SHARE',
            content: item.content,
        });
        assert.equal(message?.kind, 'unsupported');
        if (message?.kind === 'unsupported') {
            assert.equal(message.fallback.label, item.label);
            assert.equal(message.fallback.thumbUrl, undefined);
        }
    }
});

test('reel shares normalize captured XMA preview geometry before reel media loads', () => {
    const message = parseMessage({
        message_id: 'reel-with-geometry',
        sender_fbid: 'sender',
        timestamp_ms: '1000',
        content_type: 'MESSAGE_INLINE_SHARE',
        content: {
            xma: {
                target_url: 'https://www.instagram.com/reel/ABC/',
                target_id: '3953224267254190889_123',
                title_text: 'alice',
                preview_image: {
                    url: 'https://cdn.example/reel.jpg',
                    width: 1080,
                    height: 1440,
                },
            },
        },
    });
    assert.equal(message?.kind, 'reel_share');
    assert.deepEqual(
        message?.kind === 'reel_share'
            ? {
                  mediaId: message.mediaId,
                  previewWidth: message.previewWidth,
                  previewHeight: message.previewHeight,
              }
            : undefined,
        {
            mediaId: '3953224267254190889',
            previewWidth: 1080,
            previewHeight: 1440,
        },
    );
});

test('attachment-less photos and future types retain safe normalized diagnostics', () => {
    const photo = parseMessage({
        message_id: 'photo',
        content_type: 'IMAGES',
        content: {},
    });
    assert.equal(photo?.kind, 'unsupported');
    if (photo?.kind === 'unsupported')
        assert.equal(photo.fallback.label, 'Photo');

    const unknown = parseMessage({
        sender_fbid: 'sender',
        timestamp_ms: '1234',
        content_type: 'FUTURE_CARD',
    });
    assert.equal(unknown?.kind, 'unsupported');
    if (unknown?.kind === 'unsupported') {
        assert.equal(unknown.contentType, 'FUTURE_CARD');
        assert.equal(unknown.fallback.label, 'Unsupported message');
        assert.equal(unknown.id, 'sender:1234:FUTURE_CARD');
        assert.equal(unknown.isSyntheticId, true);
    }
});

test('reply previews use normalized media labels without requiring an image URL', () => {
    const shareReply = parseMessage({
        message_id: 'replying-to-share',
        content_type: 'TEXT',
        text_body: 'Nice',
        replied_to_message: {
            message_id: 'share',
            content_type: 'MESSAGE_INLINE_SHARE',
            content: {
                xma: {
                    __typename: 'SlideMessageLayeredXMA',
                    xmaTitle: 'Layered reply',
                    subtitle_text: 'Reply subtitle',
                },
            },
        },
    });
    assert.deepEqual(
        shareReply?.kind === 'text' ? shareReply.replyPreview : undefined,
        {
            kind: 'media',
            title: 'Layered reply',
            subtitle: 'Reply subtitle',
            thumbUrl: undefined,
        },
    );

    const photoReply = parseMessage({
        message_id: 'replying-to-photo',
        content_type: 'TEXT',
        text_body: 'Photo reply',
        replied_to_message: {
            message_id: 'photo',
            content_type: 'IMAGES',
            content: {},
        },
    });
    assert.deepEqual(
        photoReply?.kind === 'text' ? photoReply.replyPreview : undefined,
        {
            kind: 'media',
            title: 'Photo',
        },
    );
});

test('reactions are normalized on every renderable message variant', () => {
    const reaction = {
        reaction: '😂',
        reaction_timestamp_ms: '1783181919592',
        sender_fbid: 'viewer-1',
    };
    const messages = [
        { content_type: 'TEXT', text_body: 'hello' },
        { content_type: 'ACTION_LOG', text_body: 'activity' },
        {
            content_type: 'IMAGES',
            content: {
                attachments: [
                    { attachment_cdn_url: 'https://cdn.example/image.jpg' },
                ],
            },
        },
        {
            content_type: 'MESSAGE_INLINE_SHARE',
            content: {
                xma: {
                    header_title_text: 'Post',
                    preview_image: { url: 'https://cdn.example/post.jpg' },
                },
            },
        },
        { content_type: 'UNKNOWN_RENDERABLE' },
    ].map((fields, index) =>
        parseMessage({
            message_id: `message-${index}`,
            sender_fbid: 'sender-1',
            timestamp_ms: '1783181919592',
            reactions: [reaction],
            ...fields,
        }),
    );

    for (const message of messages)
        assert.deepEqual(message?.reactions, [
            {
                senderId: 'viewer-1',
                reaction: '😂',
                timestampMs: 1_783_181_919_592,
            },
        ]);
});
