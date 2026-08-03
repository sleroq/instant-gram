# Instagram DM MVP methods

Source captures: `examples/www.instagram.com.har`, `examples/www.instagram.com-the-second.har`, and `examples/www.instagram.com-open-reel-from-chat-and-watch.har`. Values below omit live auth tokens; use the current page's harvested `fb_dtsg`, `lsd`, `jazoest`, `csrftoken`, `device_id_for_iris_subscription`, and viewer FBID. Read methods are HAR-backed except the shortcode-resolution GraphQL query noted below; conversation pin/unpin uses the dated live evidence recorded below. See `instagram-har-useful-requests.md` for copyable request examples.

## Common request shape

- POST form body to `https://www.instagram.com/api/graphql` unless noted.
- Required body fields: `__d=www`, `__a=1`, `__comet_req=7`, `dpr=2`, `fb_api_caller_class=RelayModern`, `fb_api_req_friendly_name`, `server_timestamps=true`, `variables`, `doc_id`, plus current `fb_dtsg`, `lsd`, `jazoest`.
- Required headers seen in both HARs: `content-type: application/x-www-form-urlencoded`, `x-ig-app-id: 936619743392459`, `x-asbd-id: 359341`, `x-fb-lsd`, `x-fb-friendly-name`, `x-csrftoken`.

## Methods to implement

| method             |                         friendly name |              doc_id | variables                                                                                                                                                                                                                                                                                                                                                                                            | response path                                                       |
| ------------------ | ------------------------------------: | ------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `getInbox`         |             `PolarisDirectInboxQuery` | `27262915580045003` | `{ device_id_for_iris_subscription, __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider:false, __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider:true, __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider:5, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false, __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider:false }` | `data.get_slide_mailbox_for_iris_subscription.threads_by_folder`    |
| `getInboxPage`     | `IGDThreadListOffMsysPaginationQuery` | `27712934271665380` | `{ count:5, cursor, folder:'INBOX', newer_than_timestamp_ms:null, id:viewer_fbid, same GK flags as inbox }`                                                                                                                                                                                                                                                                                          | `data.fetch__SlideMailbox.threads_by_folder`                        |
| `getThreadHeader`  |          `IGDInboxHeaderOffMsysQuery` | `27358538347096449` | `{ thread_fbid, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }`                                                                                                                                                                                                                                                                                                           | `data.get_slide_thread_nullable.as_ig_direct_thread`                |
| `getThread`        |                `IGDThreadDetailQuery` | `27852254574460474` | `{ thread_fbid, __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider:false, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }`                                                                                                                                                                  | `data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages` |
| `getOlderMessages` |          `IGDMessageListOffMsysQuery` | `25255103937520139` | `{ after:end_cursor, before:null, first:20, last:null, newer_than_message_id:null, older_than_message_id:null, id:thread_fbid, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20 }`                                                                                                                                                                                                   | `data.fetch__SlideThread.as_ig_direct_thread.slide_messages`        |
| `getReelMedia`     | REST | — | `GET /api/v1/media/<numeric-id>/info/`; prefer the validated DM `mediaId`, otherwise decode Instagram's URL-safe-base64 shortcode | REST `items[0]`, with ID and shortcode checked |
| `pinThread`        |             `useIGDPinThreadMutation` | `26491513390471063` | `{ thread_fbid, pin:true }`                                                                                                                                                                                                                                                                                                                                                                         | `data.xig_direct_pin_thread.{ is_pin, id }`                         |
| `unpinThread`      |           `useIGDUnpinThreadMutation` | `26719492947719993` | `{ thread_fbid, pin:false }`                                                                                                                                                                                                                                                                                                                                                                        | `data.xig_direct_pin_thread.{ is_pin, id }`                         |

## Parser notes

- Inbox threads live in `threads_by_folder.edges[].node.as_ig_direct_thread`; use `threads_by_folder.page_info.end_cursor/has_next_page` for inbox pagination.
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
- `examples/www.instagram.com-open-reel-from-chat-and-watch.har` lines 3126–3139 capture `GET /api/v1/media/3887864898364318881/info/`; line 3389 returns matching `pk` and Instagram's compound `id` form. Lines 1434–1447 capture the initial comments request for that same numeric media ID with exactly `can_support_threading=true&permalink_enabled=false`. No captured request proves comment pagination or a `min_id` encoding, so the bridge exposes one lazy initial comments page only.
- `real-loading.har` and `real-loading-3.har` close the prior media-load gap
  without a private shortcode GraphQL document. A successful reel route used
  shortcode `S`, and its comments used numeric media ID `M`; decoding `S` with
  Instagram's URL-safe base64 alphabet produced exactly `M`. A separate capture
  successfully requested `GET /api/v1/media/M/info/` and returned
  `{ items: [media], status: "ok", ... }` with matching `pk` and `code`.
  `getReelMedia` therefore prefers a numeric ID already present on the DM XMA,
  falls back to that proven deterministic decode, and validates both identities
  in the REST response. The failing, uncaptured
  `PolarisPostActionLoadPostQueryQuery` route is no longer configured or called.

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
  `data.fetch__XDTMediaDict` summary metadata. ICR keeps the smaller captured
  REST comments request rather than coupling to both.
- `real-loading-3.har` proves authenticated
  `GET /api/v1/media/<media-id>/info/` with no query parameters and
  `GET /api/v1/media/<media-id>/comments/?can_support_threading=true&permalink_enabled=false`.
  The info response is `items[0]`; comments contain `comments`,
  `has_more_comments`, and `next_min_id`. The capture had no next page. ICR
  exposes one lazy comments page because no continuation request was captured.
- Successful video responses contain three `video_versions` entries (types
  101, 102, and 103); REST video captures under `docs/examples` show the same
  contract. The parser retains every unique variant, sorted by dimensions then
  bandwidth. The frontend offers Auto plus explicit variants. The new captures
  contain a single-image feed post and clips videos; `real-loading-2.har` starts
  after metadata loading and contains only CDN video transfers, so it does not
  prove a new carousel request shape. Existing strict carousel parsing remains.

## Live private-protocol evidence

Conversation pinning was reverified on 2026-08-03 from current Instagram Web
bundle `https://static.cdninstagram.com/rsrc.php/v4iZaf4/yY/l/en_US-j/mm1DRbFIyVy.js`
and reversible live traffic. It is distinct from message pinning. The mutation
identifier is `XFBIGDirectViewerThread.thread_fbid`, which can differ from the
normalized route/key. These are private persisted-query document IDs and may
drift when Instagram deploys a new bundle; update catalog fixtures from fresh,
reversible evidence rather than adding a fallback operation or embedding auth
data. No server pin-count limit was inferred because the evidence did not prove one.
