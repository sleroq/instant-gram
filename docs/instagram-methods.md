# Instagram protocol reference: captured operations

**Status: protocol reference, NOT current runtime capabilities.** The production closed provider exposes only the reads defined by [the engine contract](engine-inbox-contract.md). Mutations, polling, media loading, and comments are evidence for future R2–R5 restoration, not implemented UI features.

Tracked reference captures: `examples/www.instagram.com.har`, `examples/www.instagram.com-the-second.har`, and `examples/www.instagram.com-open-reel-from-chat-and-watch.har`. Separately named captures below are local, untracked evidence; only their sanitized descriptions are recorded here. Values omit live auth tokens; replay requires current `fb_dtsg`, `lsd`, `jazoest`, `csrftoken`, `device_id_for_iris_subscription`, and viewer FBID. Read operations below are HAR-backed; conversation pin/unpin uses the dated live evidence recorded below. See `instagram-har-useful-requests.md` for sanitized request examples.

## Common request shape

- POST form body to `https://www.instagram.com/api/graphql` unless noted.
- Required body fields: `__d=www`, `__a=1`, `__comet_req=7`, `dpr=2`, `fb_api_caller_class=RelayModern`, `fb_api_req_friendly_name`, `server_timestamps=true`, `variables`, `doc_id`, plus current `fb_dtsg`, `lsd`, `jazoest`.
- Required headers seen in both HARs: `content-type: application/x-www-form-urlencoded`, `x-ig-app-id: 936619743392459`, `x-asbd-id: 359341`, `x-fb-lsd`, `x-fb-friendly-name`, `x-csrftoken`.

## Captured operations

| method             |                                                                              friendly name |                                   doc_id | variables                                                                                                                                                                                                                                                                                                                                                                                            | response path                                                                                                     |
| ------------------ | -----------------------------------------------------------------------------------------: | ---------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `getInbox`         |                                                                  `PolarisDirectInboxQuery` |                      `27262915580045003` | `{ device_id_for_iris_subscription, __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider:false, __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider:true, __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider:5, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false, __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider:false }` | `data.get_slide_mailbox_for_iris_subscription.threads_by_folder`                                                  |
| `getInboxPage`     |                                                      `IGDThreadListOffMsysPaginationQuery` |                      `27712934271665380` | `{ count:5, cursor, folder:'INBOX', newer_than_timestamp_ms:null, id:viewer_fbid, same GK flags as inbox }`                                                                                                                                                                                                                                                                                          | `data.fetch__SlideMailbox.threads_by_folder`                                                                      |
| `getThreadHeader`  |                                                               `IGDInboxHeaderOffMsysQuery` |                      `27358538347096449` | `{ thread_fbid, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }`                                                                                                                                                                                                                                                                                                           | `data.get_slide_thread_nullable.as_ig_direct_thread`                                                              |
| `getThread`        |                                                                     `IGDThreadDetailQuery` |                      `27852254574460474` | `{ thread_fbid, __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider:false, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }`                                                                                                                                                                  | `data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages`                                               |
| `getOlderMessages` |                                                               `IGDMessageListOffMsysQuery` |                      `25255103937520139` | `{ after:end_cursor, before:null, first:20, last:null, newer_than_message_id:null, older_than_message_id:null, id:thread_fbid, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20 }`                                                                                                                                                                                                   | `data.fetch__SlideThread.as_ig_direct_thread.slide_messages`                                                      |
| `getReelMedia`     |                                                                                       REST |                                        — | `GET /api/v1/media/<numeric-id>/info/`; prefer the validated DM `mediaId`, otherwise decode Instagram's URL-safe-base64 shortcode                                                                                                                                                                                                                                                                    | REST `items[0]`, with ID and shortcode checked                                                                    |
| `pinThread`        |                                                                  `useIGDPinThreadMutation` |                      `26491513390471063` | `{ thread_fbid, pin:true }`                                                                                                                                                                                                                                                                                                                                                                          | `data.xig_direct_pin_thread.{ is_pin, id }`                                                                       |
| `unpinThread`      |                                                                `useIGDUnpinThreadMutation` |                      `26719492947719993` | `{ thread_fbid, pin:false }`                                                                                                                                                                                                                                                                                                                                                                         | `data.xig_direct_pin_thread.{ is_pin, id }`                                                                       |
| `markThreadRead`   | concurrent `useIGDMarkThreadAsReadMutation` and `useIGDMarkThreadAsReadValidationMutation` | `27356881703909995`, `35211594988486314` | item-seen `{ metadata:{ ig_thread_igid:thread_id }, data:{ item_id:'', message_id } }`; validation `{ metadata:{ ig_thread_igid:thread_id }, data:{ message_id, message_timestamp_ms:'<decimal ms>' } }`                                                                                                                                                                                             | item-seen receipt and boolean `data.xig_direct_mark_read_id_validation`                                           |
| `editText`         |                                                              `IGDirectEditMessageMutation` |                      `32480262318254796` | `{ thread_id, target_item_id:null, body:{ sensitive_string_value:text }, offline_threading_id, target_message_id }`                                                                                                                                                                                                                                                                                  | `data.direct_edit_message_with_slide_messaging_response` matching `message_id`, `id`, and original `timestamp_ms` |

## Parser notes

- Inbox threads live in `threads_by_folder.edges[].node.as_ig_direct_thread`; use `threads_by_folder.page_info.end_cursor/has_next_page` for inbox pagination.
- Conversation unread state is normalized from an explicit `marked_as_unread`
  flag or a latest incoming message newer than the viewer participant's
  `slide_read_receipts[].watermark_timestamp_ms`. Read mutations use the distinct
  large `thread_id`, never `thread_key` or the smaller operation `thread_fbid`.
- Thread messages live in `slide_messages.edges[].node`; use `slide_messages.page_info.end_cursor/has_next_page` for older-message pagination.
- Text messages are `content_type: 'TEXT'` with `content.__typename: 'SlideMessageText'` and `text_body`.
- Reel/post shares are `content_type: 'MESSAGE_INLINE_SHARE'` with `content.__typename: 'SlideMessageXMAContent'`; reel shares have `content.xma.__typename: 'SlideMessagePortraitXMA'`, `target_url` like `/reel/<shortcode>/...`, and `preview_image.url` for the thumbnail. Some shares are `SlideMessageStandardXMA` posts or `SlideMessagePlaceholderXMA` unavailable content.
- Replies are embedded as `replied_to_message`; they can contain the same text/XMA shapes as normal messages.
- A sanitized review of a user-provided, uncommitted local capture showed
  Instagram's own two-request reply jump around an opaque message ID:
  `IGDMessageListAnchorMessageRangeBeforeOffMsysQuery`
  (`doc_id: 36985093537803608`) requests `last:20`,
  `newer_than_message_id:<target>`, `include_edge_message:true`, and returns
  `slide_messages_before` including the target; the paired
  `IGDMessageListAnchorMessageRangeAfterOffMsysQuery`
  (`doc_id: 27849792908039983`) requests `first:20`,
  `older_than_message_id:<target>`, and returns `slide_messages_after` without
  the target. Both set `is_anchor_message:true`. The capture proves one isolated
  range on each side, but not continuation requests that reconnect that range to
  the currently loaded contiguous history. These private documents are therefore
  recorded capability evidence, not currently exposed RPC methods.
- `examples/www.instagram.com-open-reel-from-chat-and-watch.har` lines 3126–3139 capture `GET /api/v1/media/<media-id>/info/`; line 3389 returns matching `pk` and Instagram's compound `id` form. Lines 1434–1447 capture the initial comments request for that same numeric media ID with exactly `can_support_threading=true&permalink_enabled=false`. Later captures prove top-level `next_min_id` pagination. `comment-actions.har` additionally proves child-comment pages at `/api/v1/media/<media-id>/comments/<parent-id>/child_comments/`, with `is_chronological=true`, `paging_direction=view_more`, and opaque `next_min_child_cursor` returned unchanged as `min_id`.
- `comment-actions.har` captures comment creation at `POST /api/v1/web/comments/<media-id>/add/` (`comment_text`, plus `replied_to_comment_id` for replies), the compact returned comment entity, and `PolarisCommentActionsLikeMutation` (`doc_id 27184292767848867`, `{ input:{ comment_id, actor_id, client_mutation_id } }`). It does not capture an unlike persisted query or prove an unlike request.
- Local `real-loading.har` and `real-loading-3.har` provide media-load evidence
  without a private shortcode GraphQL document. A successful reel route used
  shortcode `S`, and its comments used numeric media ID `M`; decoding `S` with
  Instagram's URL-safe base64 alphabet produced exactly `M`. A separate capture
  successfully requested `GET /api/v1/media/M/info/` and returned
  `{ items: [media], status: "ok", ... }` with matching `pk` and `code`.
  A future media loader can prefer a numeric ID already present on the DM XMA,
  otherwise use that deterministic decode, and validate both identities in the
  REST response.

### Sanitized 2026-08 media-loading evidence

The raw `real-loading*.har` files remain local evidence and may contain live
session data; do not commit or quote their headers, tokens, IDs, or CDN URLs.

- `real-loading.har` loaded `/reels/<shortcode>/`, then Instagram's feed/reels
  UI used `POST /graphql/query`. `PolarisFeedTimelineRootV2Query`
  (`doc_id 37687185124228442`) sent
  `{ after:null, before:null, data:{ device_id:<session device ID>, is_async_ads_double_request:"0", is_async_ads_in_headload_enabled:"0", is_async_ads_rti:"0", rti_delivery_backend:"0" }, first:3, last:null, variant:"home", __relay_internal__pv__PolarisShortDramaEnabledrelayprovider:false, __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider:false, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false, __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider:false }`.
  `PolarisClipsTabDesktopPaginationQuery` (`doc_id 27590726200579843`)
  sent `{ after:<cursor>, before:null, data:{ container_module:"clips_tab_desktop_page", seen_reels:<JSON string>, chaining_media_id:<shortcode>, should_refetch_chaining_media:false }, first:10, last:null, __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider:false, __relay_internal__pv__PolarisShortDramaEnabledrelayprovider:false }`.
  Their response roots are respectively
  `data.xdt_api__v1__feed__timeline__connection.edges[].node.media` and
  `data.xdt_api__v1__clips__home__connection_v2.edges[].node.media`.
  These are feed pagination calls, not a reliable arbitrary-shortcode loader.
- The same capture loaded comments through two UI GraphQL queries:
  `POST /api/graphql` `PolarisPostCommentsContainerQuery`
  (`doc_id 37622913243966296`, `{ media_id, __relay_internal__pv__PolarisIsLoggedInrelayprovider:true }`)
  returns `data.xdt_api__v1__media__media_id__comments__connection`, while
  `PolarisClipsDesktopCommentsPopoverQuery`
  (`doc_id 26898197033164947`, `{ media_id }`) returns
  `data.fetch__XDTMediaDict` summary metadata. The smaller captured REST
  comments request is a separate protocol option.
- `real-loading-3.har` proves authenticated
  `GET /api/v1/media/<media-id>/info/` with no query parameters and
  `GET /api/v1/media/<media-id>/comments/?can_support_threading=true&permalink_enabled=false`.
  The info response is `items[0]`; comments contain `comments`,
  `has_more_comments`, and `next_min_id`. This capture had no next-page request;
  those response fields alone do not prove continuation.
- Successful video responses contain three `video_versions` entries (types
  101, 102, and 103); REST video captures under `docs/examples` show the same
  contract. These are media descriptors, not evidence of a current player or
  variant selector. The local captures contain a single-image feed post and
  clips videos; `real-loading-2.har` starts after metadata loading and contains
  only CDN video transfers, so it does not prove a carousel request shape.

## Live private-protocol evidence

Conversation pinning was reverified on 2026-08-03 from current Instagram Web
bundle `https://static.cdninstagram.com/rsrc.php/v4iZaf4/yY/l/en_US-j/mm1DRbFIyVy.js`
and reversible live traffic. It is distinct from message pinning. The mutation
identifier is `XFBIGDirectViewerThread.thread_fbid`, which can differ from the
normalized route/key. These are private persisted-query document IDs and may
drift when Instagram deploys a new bundle; update catalog fixtures from fresh,
reversible evidence rather than adding a fallback operation or embedding auth
data. No server pin-count limit was inferred because the evidence did not prove one.
