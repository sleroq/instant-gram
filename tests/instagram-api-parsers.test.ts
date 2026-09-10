import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject } from '../lib/json.ts';
import {
    parseInboxResponse,
    parseEditedTextResponse,
    parseMarkThreadReadResponse,
    parseMarkThreadReadValidationResponse,
    parseMessage,
    parseMessageActionsResponse,
    parseMessageRequestsResponse,
    parsePinnedMessageResponse,
    parsePinnedThreadResponse,
    parseReactionMutationResponse,
    parseCreatedReelCommentResponse,
    parseReelCommentRepliesResponse,
    parseReelCommentsResponse,
    parseReelInfoResponse,
    parseReelLikeResponse,
    parseReelSaveResponse,
    parseSentCutoutStickerResponse,
    parseSentTextResponse,
    parseSecondaryGraphqlResponse,
    parseThreadInfoResponses,
    parseThread,
    parseThreadResponse,
    parseUnreadCountResponses,
} from '../lib/instagram-api/parsers.ts';

import {
    instagramMediaIdFromShortcode,
    loadReelMedia,
} from '../lib/instagram-api/reels.ts';

test('edited text parser requires the captured matching IDs and timestamp', () => {
    assert.deepEqual(parseEditedTextResponse({ data: {
        direct_edit_message_with_slide_messaging_response: {
            message_id: 'mid.$message',
            timestamp_ms: '1786399709281',
            id: 'mid.$message',
        },
    } }), { messageId: 'mid.$message', timestampMs: 1_786_399_709_281 });
    assert.throws(() => parseEditedTextResponse({ data: {
        direct_edit_message_with_slide_messaging_response: {
            message_id: 'mid.$message', timestamp_ms: '1786399709281', id: 'other',
        },
    } }), /receipt/);
});

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

test('thread unread state compares the latest incoming message with the viewer watermark', () => {
    const parsed = parseThread({
        thread_key: 'person-1',
        thread_id: 'read-receipt-1',
        viewer: { interop_messaging_user_fbid: 'viewer-fbid' },
        marked_as_unread: false,
        slide_read_receipts: [{
            participant_fbid: 'viewer-fbid',
            watermark_timestamp_ms: '1786269297000',
        }],
        slide_messages: { edges: [{ node: {
            id: 'latest-message',
            sender_fbid: 'peer-fbid',
            timestamp_ms: '1786269297434',
            content_type: 'TEXT',
            content: { __typename: 'SlideMessageText', text_body: 'new' },
        } }] },
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

test('conversation pin receipt requires authoritative id and boolean state', () => {
    assert.deepEqual(parsePinnedThreadResponse({
        data: { xig_direct_pin_thread: { is_pin: false, id: '1789001' } },
    }), { threadFbid: '1789001', isPinned: false });
    assert.throws(
        () => parsePinnedThreadResponse({ data: { xig_direct_pin_thread: { is_pin: 'false', id: '1789001' } } }),
        /receipt was not returned/,
    );
    assert.throws(
        () => parsePinnedThreadResponse({ data: { xig_direct_pin_thread: { is_pin: true } } }),
        /receipt was not returned/,
    );
    assert.throws(
        () => parsePinnedThreadResponse({ data: { xig_direct_pin_thread: { is_pin: true, id: 'route-key' } } }),
        /receipt was not returned/,
    );
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
            node: { content: { text_fragments: [{ plaintext: 'fragment-only text' }] } },
            expected: 'text',
        },
        {
            type: 'IMAGES',
            node: { content: { attachments: [{ preview_cdn_url: 'https://cdn.example/photo.jpg' }] } },
            expected: 'image',
        },
        {
            type: 'MESSAGE_INLINE_SHARE',
            node: { content: { xma: {
                __typename: 'SlideMessageStandardXMA',
                title_text: 'Shared post',
                subtitle_text: 'Post caption',
                preview_image: { url: 'https://cdn.example/post.jpg' },
            } } },
            expected: 'inline_share',
        },
        { type: 'REACTION_LOG_XMAT', node: {}, expected: undefined },
        {
            type: 'CHANGE_THREAD_IMAGE_XMAT',
            node: { content: { text_fragments: [{ plaintext: 'Alice changed the group image.' }] } },
            expected: 'activity',
        },
        {
            type: 'CHANGE_THREAD_NAME_XMAT',
            node: { content: { text_fragments: [{ plaintext: 'Alice named the group Friends.' }] } },
            expected: 'activity',
        },
        { type: 'MONTAGE_SHARE_XMA', node: { text_body: 'Story reply' }, expected: 'unsupported' },
        {
            type: 'REMOVE_PARTICIPANT_XMAT',
            node: { content: { text_fragments: [{ plaintext: 'Alice removed Bob' }] } },
            expected: 'activity',
        },
        { type: 'GEN_AI_RICH_RESPONSE_XMA', node: { text_body: 'AI answer' }, expected: 'unsupported' },
        { type: 'GEN_AI_SEARCH_PLUGIN_RESPONSE_XMA', node: { text_body: 'Search answer' }, expected: 'unsupported' },
        { type: 'IG_REELS_BLEND_VISITATION_XMAT', node: {}, expected: 'unsupported' },
        {
            type: 'THREAD_IGD_NEW_FRIEND_BUMP_XMAT',
            node: { content: { text_fragments: [{ plaintext: 'You can now message each other.' }] } },
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
            content: { xma: {
                __typename: 'SlideMessagePlaceholderXMA',
                title_text: 'Message unavailable',
                subtitle_text: 'This content is no longer available.',
            } },
            label: 'Message unavailable',
        },
        {
            content: { xma: { title_text: 'Broken preview', preview_image: { url: '' } } },
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
        content: { xma: {
            target_url: 'https://www.instagram.com/reel/ABC/',
            target_id: '3953224267254190889_123',
            title_text: 'alice',
            preview_image: {
                url: 'https://cdn.example/reel.jpg',
                width: 1080,
                height: 1440,
            },
        } },
    });
    assert.equal(message?.kind, 'reel_share');
    assert.deepEqual(message?.kind === 'reel_share' ? {
        mediaId: message.mediaId,
        previewWidth: message.previewWidth,
        previewHeight: message.previewHeight,
    } : undefined, {
        mediaId: '3953224267254190889',
        previewWidth: 1080,
        previewHeight: 1440,
    });
});

test('feed post shares use the modal media path and normalize attached music', () => {
    const message = parseMessage({
        message_id: 'post-share',
        sender_fbid: 'sender',
        timestamp_ms: '1000',
        content_type: 'MESSAGE_INLINE_SHARE',
        content: { xma: {
            target_url: 'https://www.instagram.com/p/Dbcvq9_MYOc/',
            target_id: '3953244233886958492',
            header_title_text: 'alice',
            preview_image: { url: 'https://cdn.example/post.jpg', width: 1080, height: 1080 },
        } },
    });
    assert.deepEqual(message?.kind === 'reel_share' ? {
        mediaType: message.mediaType,
        shortcode: message.shortcode,
        mediaId: message.mediaId,
    } : undefined, {
        mediaType: 'post',
        shortcode: 'Dbcvq9_MYOc',
        mediaId: '3953244233886958492',
    });

    const media = parseReelInfoResponse({ items: [{
        pk: '3953244233886958492',
        code: 'Dbcvq9_MYOc',
        media_type: 1,
        product_type: 'feed',
        original_width: 1080,
        original_height: 1080,
        image_versions2: { candidates: [{ url: 'https://cdn.example/post.jpg', width: 1080, height: 1080 }] },
        user: { pk: 'owner', username: 'alice' },
        music_metadata: { music_info: {
            music_asset_info: {
                audio_asset_id: '1525098932292312',
                progressive_download_url: 'https://cdn.example/music.mp4',
                duration_in_ms: 138275,
                title: 'cloud city',
                display_artist: 'frutiger pm',
            },
            music_consumption_info: {
                audio_asset_start_time_in_ms: 3000,
                overlap_duration_in_ms: 30000,
            },
        } },
    }] }, { shortcode: 'Dbcvq9_MYOc', mediaId: '3953244233886958492' });
    assert.equal(media.mediaType, 'post');
    assert.deepEqual(media.displayMusic, { title: 'cloud city', artist: 'frutiger pm' });
    assert.deepEqual(media.attachedAudio, {
        id: '1525098932292312',
        url: 'https://cdn.example/music.mp4',
        title: 'cloud city',
        artist: 'frutiger pm',
        durationSec: 138.275,
        startTimeSec: 3,
        playDurationSec: 30,
    });
});

test('reel info exposes visible licensed music without attaching a soundtrack', () => {
    const base = {
        pk: '3959981606806396400',
        code: 'Db0rkpexp3w',
        media_type: 2,
        product_type: 'clips',
        original_width: 1080,
        original_height: 1920,
        video_versions: [{ url: 'https://cdn.example/reel.mp4', width: 1080, height: 1920 }],
    };
    const media = parseReelInfoResponse({ items: [{
        ...base,
        clips_metadata: { music_info: {
            music_asset_info: {
                audio_asset_id: '169754582898981',
                title: 'Redbone (Gloopy)',
                display_artist: 'kaemvn',
                progressive_download_url: 'https://cdn.example/music.mp4',
            },
            music_consumption_info: { audio_asset_start_time_in_ms: 14500 },
        } },
    }] }, { shortcode: 'Db0rkpexp3w' });

    assert.deepEqual(media.displayMusic, {
        title: 'Redbone (Gloopy)',
        artist: 'kaemvn',
    });
    assert.equal(media.attachedAudio, undefined);

    const withoutMusic = parseReelInfoResponse({ items: [base] }, { shortcode: 'Db0rkpexp3w' });
    assert.equal(withoutMusic.displayMusic, undefined);

    const originalAudio = parseReelInfoResponse({ items: [{
        ...base,
        clips_metadata: { original_sound_info: {
            original_audio_title: 'Original audio',
            ig_artist: { username: 'reel_author', full_name: 'Reel Author' },
        } },
    }] }, { shortcode: 'Db0rkpexp3w' });
    assert.deepEqual(originalAudio.displayMusic, {
        title: 'Original audio',
        artist: 'Reel Author',
    });
});

test('attachment-less photos and future types retain safe normalized diagnostics', () => {
    const photo = parseMessage({ message_id: 'photo', content_type: 'IMAGES', content: {} });
    assert.equal(photo?.kind, 'unsupported');
    if (photo?.kind === 'unsupported') assert.equal(photo.fallback.label, 'Photo');

    const unknown = parseMessage({ sender_fbid: 'sender', timestamp_ms: '1234', content_type: 'FUTURE_CARD' });
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
    assert.deepEqual(shareReply?.kind === 'text' ? shareReply.replyPreview : undefined, {
        kind: 'media',
        title: 'Layered reply',
        subtitle: 'Reply subtitle',
        thumbUrl: undefined,
    });

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
    assert.deepEqual(photoReply?.kind === 'text' ? photoReply.replyPreview : undefined, {
        kind: 'media',
        title: 'Photo',
    });
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
            content: { attachments: [{ attachment_cdn_url: 'https://cdn.example/image.jpg' }] },
        },
        {
            content_type: 'MESSAGE_INLINE_SHARE',
            content: { xma: { header_title_text: 'Post', preview_image: { url: 'https://cdn.example/post.jpg' } } },
        },
        { content_type: 'UNKNOWN_RENDERABLE' },
    ].map((fields, index) => parseMessage({
        message_id: `message-${index}`,
        sender_fbid: 'sender-1',
        timestamp_ms: '1783181919592',
        reactions: [reaction],
        ...fields,
    }));

    for (const message of messages)
        assert.deepEqual(message?.reactions, [{
            senderId: 'viewer-1',
            reaction: '😂',
            timestampMs: 1_783_181_919_592,
        }]);
});

test('thread info independently preserves divergent UI, operation, and read-receipt identifiers', () => {
    function response(thread: JsonObject) {
        return {
        data: {
            get_slide_thread_nullable: { as_ig_direct_thread: thread },
        },
        };
    }
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
                    slide_message: {
                        id: 'message-1',
                        reactions: [{
                            reaction: '❤',
                            reaction_timestamp_ms: '1783181919592',
                            sender_fbid: 'viewer-1',
                        }],
                    },
                },
            },
        }),
        {
            messageId: 'message-1',
            reactions: [{
                senderId: 'viewer-1',
                reaction: '❤',
                timestampMs: 1_783_181_919_592,
            }],
        },
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

test('mutation parsers reject malformed successful GraphQL envelopes', () => {
    assert.throws(
        () => parseSentTextResponse({ data: {
            xig_direct_text_send_with_slide_messaging_response: {
                message_id: 'sent-without-timestamp',
            },
        } }, '7001'),
        /timestamp was not returned/,
    );
    assert.throws(
        () => parseSentTextResponse({ data: {} }, '7001'),
        /message ID was not returned/,
    );
    assert.throws(
        () => parseReactionMutationResponse({ data: {
            xig_direct_reaction_send_with_slide_messaging_response: {
                slide_message: { id: 'message-1' },
            },
        } }),
        /malformed/,
    );
    assert.throws(
        () => parseReactionMutationResponse({ data: {
            xig_direct_reaction_send_with_slide_messaging_response: {
                slide_message: {
                    id: 'message-1',
                    reactions: [{ reaction: '❤', sender_fbid: 'viewer-1' }],
                },
            },
        } }),
        /malformed/,
    );
});

test('reel info represents captured video variants and complete carousel media', () => {
    const base = {
        pk: '3953224267254190889',
        code: 'ABC',
        user: {
            pk: 'owner-1', username: 'alice', full_name: 'Alice',
            profile_pic_url: 'https://cdn.example/avatar.jpg', is_verified: true,
        },
        caption: { text: 'Caption' },
        like_count: 3,
        comment_count: 4,
        has_liked: true,
        has_viewer_saved: true,
        can_viewer_save: true,
        is_third_party_downloads_eligible: true,
    };
    const parsed = parseReelInfoResponse({ items: [{
        ...base,
        media_type: 8,
        product_type: 'carousel_container',
        carousel_media: [{
            pk: 'slide-video', video_duration: 5,
            original_width: 1080, original_height: 1920,
            video_versions: [
                { url: 'https://cdn.example/video-low.mp4', type: 101, width: 360, height: 640 },
                { url: 'https://cdn.example/video-high.mp4', type: 102, width: 720, height: 1280 },
                { url: 'https://cdn.example/video-alt.mp4', type: 103, width: 720, height: 1280 },
            ],
            image_versions2: { candidates: [{ url: 'https://cdn.example/poster.jpg', width: 720, height: 1280 }] },
        }, {
            pk: 'slide-image',
            image_versions2: { candidates: [{ url: 'https://cdn.example/image.jpg', width: 1080, height: 1080 }] },
        }, {
            pk: 'slide-landscape', original_width: 1920, original_height: 1080,
            image_versions2: { candidates: [{ url: 'https://cdn.example/landscape.jpg', width: 960, height: 540 }] },
        }],
    }] }, { shortcode: 'ABC' });

    assert.equal(parsed.id, '3953224267254190889');
    assert.deepEqual(parsed.author, {
        id: 'owner-1', username: 'alice', fullName: 'Alice',
        picUrl: 'https://cdn.example/avatar.jpg', isVerified: true,
    });
    assert.deepEqual(parsed.items.map(item => item.kind), ['video', 'image', 'image']);
    assert.deepEqual(parsed.items.map(item => [item.width, item.height]), [
        [1080, 1920], [1080, 1080], [1920, 1080],
    ]);
    assert.equal(parsed.items[0]?.posterUrl, 'https://cdn.example/poster.jpg');
    assert.equal(parsed.items[0]?.kind === 'video' && parsed.items[0].videoUrl,
        'https://cdn.example/video-high.mp4');
    assert.deepEqual(parsed.items[0]?.kind === 'video' &&
        parsed.items[0].variants.map(variant => variant.type), [102, 103, 101]);
    assert.equal(parsed.items[0]?.canDownload, true);
    assert.equal(parsed.items[0]?.downloadUrl, 'https://cdn.example/video-high.mp4');
    assert.equal(parsed.hasLiked, true);
    assert.equal(parsed.hasSaved, true);
    assert.equal(parsed.canDownload, true);

    const incompleteOriginal = parseReelInfoResponse({ items: [{
        ...base,
        media_type: 1,
        product_type: 'feed',
        original_width: 2_000,
        image_versions2: { candidates: [{
            url: 'https://cdn.example/fallback-landscape.jpg', width: 640, height: 360,
        }] },
    }] }, { shortcode: 'ABC' });
    assert.deepEqual(
        [incompleteOriginal.items[0].width, incompleteOriginal.items[0].height],
        [640, 360],
        'dimensions must come from one complete source pair',
    );
});

test('reel identities and complete mixed carousels are required end to end', () => {
    const media = {
        pk: '3953224267254190889', id: '3953224267254190889_5654194264', code: 'ABC',
        media_type: 8, product_type: 'carousel_container',
        is_third_party_downloads_eligible: false,
        carousel_media: [{ image_versions2: { candidates: [{ url: 'https://cdn/one.jpg' }] } },
            null,
            { video_versions: [{ url: 'https://cdn/three.mp4' }] }],
    };
    assert.throws(
        () => parseReelInfoResponse({ items: [media] }, {
            shortcode: 'ABC', mediaId: '3953224267254190889',
        }),
        /malformed media/,
    );
    assert.throws(() => parseReelInfoResponse({ items: [{
        ...media, carousel_media: media.carousel_media.filter(Boolean), code: 'WRONG',
    }] }, { shortcode: 'ABC', mediaId: '3953224267254190889' }), /identity did not match/);
    assert.throws(() => parseReelInfoResponse({ items: [{
        ...media, carousel_media: media.carousel_media.filter(Boolean), pk: '3953224267254190999',
        id: '3953224267254190999_5654194264',
    }] }, { shortcode: 'ABC', mediaId: '3953224267254190889' }), /identity did not match/);

    for (const carousel_media of [undefined, null, {}, []]) {
        assert.throws(() => parseReelInfoResponse({ items: [{
            ...media,
            carousel_media,
        }] }, { shortcode: 'ABC' }), /carousel media was not returned/);
    }
    assert.throws(() => parseReelInfoResponse({ items: [{
        ...media,
        media_type: 1,
        product_type: 'carousel_container',
        carousel_media: null,
    }] }, { shortcode: 'ABC' }), /carousel media was not returned/);

    const single = {
        ...media,
        media_type: 1,
        product_type: 'feed',
        image_versions2: { candidates: [{ url: 'https://cdn/parent.jpg', width: 1080, height: 1080 }] },
    };
    for (const carousel_media of [[], [{
        image_versions2: { candidates: [{ url: 'https://cdn/not-a-slide.jpg' }] },
    }]]) {
        const parsed = parseReelInfoResponse({ items: [{
            ...single,
            carousel_media,
        }] }, { shortcode: 'ABC' });
        assert.equal(parsed.items.length, 1);
        assert.equal(parsed.items[0]?.kind, 'image');
        assert.equal(parsed.items[0]?.downloadUrl, undefined);
        assert.equal(parsed.items[0]?.posterUrl, 'https://cdn/parent.jpg');
    }
});

test('media-ID shares bypass GraphQL and shortcode fallback decodes the captured identity', async () => {
    const calls: string[] = [];
    function fixture(mediaId: string, code: string) {
        return { items: [{
            pk: mediaId,
            code,
            media_type: 1,
            product_type: 'feed',
            image_versions2: { candidates: [{ url: 'https://cdn.example/post.jpg', width: 1080, height: 1080 }] },
            user: { pk: 'owner', username: 'owner' },
        }] };
    }
    const mediaBacked = await loadReelMedia({ shortcode: 'ABC', mediaId: '9001' }, async mediaId => {
        calls.push(mediaId);
        return fixture(mediaId, 'ABC');
    });
    assert.equal(mediaBacked.items[0]?.kind, 'image');
    assert.deepEqual(calls, ['9001']);

    const decoded = instagramMediaIdFromShortcode('ABC');
    const fallback = await loadReelMedia({ shortcode: 'ABC' }, async mediaId => {
        calls.push(mediaId);
        return fixture(mediaId, 'ABC');
    });
    assert.equal(fallback.id, decoded);
    assert.deepEqual(calls, ['9001', decoded]);
});

test('reel comments retain the captured opaque pagination cursor', () => {
    assert.deepEqual(parseReelCommentsResponse({
        comments: [{
            pk: 'comment-1', text: 'Hello', created_at: 1_700_000_000,
            comment_like_count: 2, has_liked_comment: false, child_comment_count: 1,
            user: { pk: 'user-1', username: 'bob', full_name: 'Bob', is_verified: false },
        }],
        has_more_comments: true,
        next_min_id: '{"cached_comments_cursor":"next","bifilter_token":"token"}',
    }), {
        items: [{
            id: 'comment-1', text: 'Hello', createdAtMs: 1_700_000_000_000,
            likeCount: 2, hasLiked: false, childCommentCount: 1,
            author: { id: 'user-1', username: 'bob', fullName: 'Bob', picUrl: null, isVerified: false },
        }],
        cursor: '{"cached_comments_cursor":"next","bifilter_token":"token"}',
        hasNextPage: true,
    });
    assert.deepEqual(parseReelLikeResponse({ data: {
        xig_media_unlike: { media: { id: '3953224267254190889_5654194264', has_liked: true } },
    } }, false), { mediaId: '3953224267254190889', hasLiked: false });
    assert.deepEqual(parseReelSaveResponse({ data: {
        xig_media_save: { media: { id: '3953224267254190889_5654194264' } },
    } }, true), { mediaId: '3953224267254190889', hasSaved: true });
});

test('comment action responses normalize created replies and opaque child cursors', () => {
    const author = {
        id: '74742604942', username: 'sleroqq', full_name: 'Sleroq',
        profile_picture: 'https://cdn.example/viewer.jpg',
    };
    assert.deepEqual(parseCreatedReelCommentResponse({
        id: '17974739376065649', from: author, text: '@author reply',
        created_time: 1_786_399_227, status: 'ok',
    }, '18020579816703103'), {
        id: '17974739376065649', text: '@author reply', createdAtMs: 1_786_399_227_000,
        likeCount: 0, hasLiked: false, childCommentCount: 0,
        parentCommentId: '18020579816703103', repliedToCommentId: '18020579816703103',
        author: {
            id: '74742604942', username: 'sleroqq', fullName: 'Sleroq',
            picUrl: 'https://cdn.example/viewer.jpg', isVerified: false,
        },
    });
    const reply = {
        pk: '17960232189149842', text: '@parent reply', created_at: 1_784_152_061,
        comment_like_count: 251, has_liked_comment: false,
        parent_comment_id: '18118594957890789', replied_to_comment_id: '18118594957890789',
        user: { pk: '60803639014', username: 'reply-user', full_name: 'Reply User', is_verified: false },
    };
    const parsed = parseReelCommentRepliesResponse({
        child_comments: [reply], parent_comment: { pk: '18118594957890789' },
        next_min_child_cursor: 'opaque-child-cursor', status: 'ok',
    }, '18118594957890789');
    assert.equal(parsed.cursor, 'opaque-child-cursor');
    assert.equal(parsed.hasNextPage, true);
    assert.equal(parsed.items[0]?.parentCommentId, '18118594957890789');
});

test('reel social context requires proven viewer-following and explicit ranked-comment markers', async () => {
    const media = {
        pk: '3953224267254190889', code: 'ABC', media_type: 1, product_type: 'feed',
        original_width: 1080, original_height: 1080,
        image_versions2: { candidates: [{ url: 'https://cdn.example/post.jpg', width: 1080, height: 1080 }] },
        user: { pk: 'owner', username: 'owner' },
        top_likers: ['friend-1', 'friend-2', 'friend-3', 'friend-4', 'friend-5', 'friend-6'],
        facepile_top_likers: ['friend-6', 'friend-5', 'friend-4', 'friend-3', 'friend-2', 'friend-1'].map(username => ({
            pk: `${username}-id`, username, full_name: username, profile_pic_url: `https://cdn.example/${username}.jpg`,
        })),
    };
    const requestedIds: string[] = [];
    const followed = await loadReelMedia({ shortcode: 'ABC', mediaId: media.pk }, async () => ({ items: [media] }), async userId => {
        requestedIds.push(userId);
        return { data: { xig_user_by_igid_v2: { user_dict: {
            pk: userId, friendship_status: { following: true },
        } } } };
    });
    assert.deepEqual(requestedIds, ['friend-1-id', 'friend-2-id', 'friend-3-id', 'friend-4-id', 'friend-5-id']);
    assert.deepEqual(followed.followedLikers?.map(user => user.id), requestedIds);
    const notFollowed = await loadReelMedia({ shortcode: 'ABC', mediaId: media.pk }, async () => ({ items: [media] }), async userId => ({
        data: { xig_user_by_igid_v2: { user_dict: {
            pk: userId, friendship_status: { following: false },
        } } },
    }));
    assert.equal(notFollowed.followedLikers, undefined);
    const mismatchedUser = await loadReelMedia({ shortcode: 'ABC', mediaId: media.pk }, async () => ({ items: [media] }), async () => ({
        data: { xig_user_by_igid_v2: { user_dict: {
            pk: 'different-user', friendship_status: { following: true },
        } } },
    }));
    assert.equal(mismatchedUser.followedLikers, undefined);
    const unavailableFriendship = await loadReelMedia(
        { shortcode: 'ABC', mediaId: media.pk },
        async () => ({ items: [media] }),
        async () => { throw new Error('Hover card unavailable'); },
    );
    assert.equal(unavailableFriendship.followedLikers, undefined);
    assert.equal(unavailableFriendship.id, media.pk);

    const rankedComment = {
        pk: 'ranked', text: 'A friend was here', comment_index: 0, is_ranked_comment: true,
        user: { pk: 'friend-id', username: 'friend' },
    };
    assert.equal(parseReelCommentsResponse({
        is_ranked: true, comments: [rankedComment],
    }).featuredCommentId, 'ranked');
    assert.equal(parseReelCommentsResponse({
        is_ranked: false, comments: [rankedComment],
    }).featuredCommentId, undefined);
});
