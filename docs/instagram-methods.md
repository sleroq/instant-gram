# Instagram protocol reference

Shipped descriptors and variable builders are canonical:
[`catalog.ts`](../lib/instagram-api/catalog.ts) and
[`mutations.ts`](../lib/instagram-api/mutations.ts). Private document IDs drift;
update them from fresh evidence, not fallback guesses. Protocol references do
not authorize UI-owned adapters. See [application ownership](application-architecture.md).

## Requests and identity

- GraphQL uses form-encoded `POST https://www.instagram.com/api/graphql`.
  Captured common fields: `__d=www`, `__a=1`, `__comet_req=7`, `dpr=2`,
  `fb_api_caller_class=RelayModern`, `server_timestamps=true`,
  `fb_api_req_friendly_name`, `doc_id`, JSON `variables`, `fb_dtsg`, `lsd`, `jazoest`.
- Captured headers: `content-type: application/x-www-form-urlencoded`,
  `x-ig-app-id: 936619743392459`, `x-asbd-id: 359341`, `x-fb-lsd`,
  `x-fb-friendly-name`, `x-csrftoken`.
- [`ig-auth.ts`](../lib/ig-auth.ts) obtains current page tokens, device ID and
  viewer FBID; `csrftoken` comes from the cookie and `jazoest` is derived from
  `fb_dtsg`. See [capture handling](README.md#protocol-captures).
- Keep normalized thread key, operation `thread_fbid`, and large Instagram
  `thread_id` distinct. Read markers use `thread_id`; pin and send builders use
  `thread_fbid`, even where the wire field is named `ig_thread_igid`.

## Shipped GraphQL operations

| Friendly name                              | Document ID         | Purpose                                              |
| ------------------------------------------ | ------------------- | ---------------------------------------------------- |
| `PolarisDirectInboxQuery`                  | `27832650746344714` | Newest inbox; device ID and list flags               |
| `IGDThreadListOffMsysPaginationQuery`      | `28035404249479587` | `count:5`, opaque cursor, `folder:INBOX`, mailbox ID |
| `IGDThreadDetailQuery`                     | `28053520164245408` | Newest 20 messages by `thread_fbid`                  |
| `IGDMessageListOffMsysQuery`               | `25255103937520139` | Older 20 via `after:end_cursor`, `id:thread_fbid`    |
| `IGDirectTextSendMutation`                 | `26911679871773184` | Text/reply with numeric `offline_threading_id`       |
| `useIGDPinThreadMutation`                  | `26491513390471063` | `{ thread_fbid, pin:true }`                          |
| `useIGDUnpinThreadMutation`                | `26719492947719993` | `{ thread_fbid, pin:false }`                         |
| `useIGDMarkThreadAsReadMutation`           | `27356881703909995` | Item-seen marker                                     |
| `useIGDMarkThreadAsReadValidationMutation` | `35211594988486314` | Paired read validation                               |

### Response and receipt semantics

- Initial inbox: `data.get_slide_mailbox_for_iris_subscription.threads_by_folder`;
  pagination: `data.fetch__SlideMailbox.threads_by_folder`.
  Threads are `edges[].node.as_ig_direct_thread`.
- Initial history: `data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages`;
  older history: `data.fetch__SlideThread.as_ig_direct_thread.slide_messages`.
  Messages are `edges[].node`. Both connections use
  `page_info.end_cursor/has_next_page`; retained entities alone prove no coverage.
- Text: `content_type:TEXT`, `content.__typename:SlideMessageText`, `text_body`.
  Shares: `MESSAGE_INLINE_SHARE` / `SlideMessageXMAContent`; portrait XMA carries
  reel `target_url` and `preview_image.url`. Standard XMA can be a post;
  placeholder XMA can be unavailable. `replied_to_message` embeds these shapes.
- Unread projection uses explicit `marked_as_unread` or a latest incoming message
  newer than the viewer's `slide_read_receipts[].watermark_timestamp_ms`.
- Send result `data.xig_direct_text_send_with_slide_messaging_response` must have
  equal `id`/`message_id` and decimal `timestamp_ms`. It lacks target/author;
  shipped validation also requires a history echo matching viewer, thread,
  timestamp, and message identity. Unknown outcomes are not blind retry permission.
- Pin result `data.xig_direct_pin_thread` supplies matching thread `id` and `is_pin`.
  Conversation pinning is not message pinning; no server pin-count limit is proven.
- Both read requests use `metadata:{ ig_thread_igid:thread_id }`.
  Item-seen data is `{ item_id:'', message_id }`; validation data is
  `{ message_id, message_timestamp_ms:'<decimal ms>' }`.
  Item-seen result `xig_direct_item_seen_mutation_with_slide_messaging_response`
  must be `XFBSlideReadReceipt`, match the current viewer's `participant_fbid`,
  and have watermark at least the seen timestamp. Paired
  `xig_direct_mark_read_id_validation` must be boolean; do not infer that only
  `true` is an accepted receipt. Mark only the latest actually seen message.

## Future message interactions

Sanitized local captures establish these shapes, not shipped RPCs:

- Header: `IGDInboxHeaderOffMsysQuery`, `27358538347096449`,
  `{ thread_fbid, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }`;
  result `data.get_slide_thread_nullable.as_ig_direct_thread`.
- Edit: `IGDirectEditMessageMutation`, `32480262318254796`,
  `{ thread_id:thread_fbid, target_item_id:null, body:{ sensitive_string_value:text },
offline_threading_id, target_message_id }`. Result
  `data.direct_edit_message_with_slide_messaging_response` matches `message_id`,
  `id`, and the original `timestamp_ms`. Evidence covers text only.
- Reply anchor before: `IGDMessageListAnchorMessageRangeBeforeOffMsysQuery`,
  `36985093537803608`, `last:20`, `newer_than_message_id:target`,
  `include_edge_message:true`; `slide_messages_before` includes target.
  After: `IGDMessageListAnchorMessageRangeAfterOffMsysQuery`,
  `27849792908039983`, `first:20`, `older_than_message_id:target`;
  `slide_messages_after` excludes target. Both use `is_anchor_message:true`.
  Isolated ranges do not prove continuation reconnecting to loaded history.
- Reaction and transport evidence: [live communication](instagram-live-communication.md).

## Future media and comments

- `GET /api/v1/media/<numeric-id>/info/` returns `items[0]`.
  Prefer validated DM media ID; otherwise Instagram URL-safe-base64 shortcode
  decoding has matched the numeric REST ID. Validate `pk` and `code` before caching;
  compound `id` can be `<media-id>_<owner-id>`.
- Videos expose `video_versions` (captured types 101, 102, 103). Metadata and CDN
  transfers prove neither a player nor carousel loading.
- Initial comments: `GET /api/v1/media/<media-id>/comments/` with
  `can_support_threading=true&permalink_enabled=false`. Response has `comments`,
  `has_more_comments`, `next_min_id`; later captures prove `min_id` continuation.
- Child comments: `/api/v1/media/<media-id>/comments/<parent-id>/child_comments/`,
  `is_chronological=true`, `paging_direction=view_more`; return opaque
  `next_min_child_cursor` unchanged as `min_id`.
- Create: `POST /api/v1/web/comments/<media-id>/add/`, `comment_text`, optional
  `replied_to_comment_id`; response contains the created comment.
- Like: `PolarisCommentActionsLikeMutation`, `27184292767848867`,
  `{ input:{ comment_id, actor_id, client_mutation_id } }`. Unlike is not captured.
- Alternative comment queries: `PolarisPostCommentsContainerQuery`,
  `37622913243966296`, `{ media_id, __relay_internal__pv__PolarisIsLoggedInrelayprovider:true }`
  returns `data.xdt_api__v1__media__media_id__comments__connection`;
  `PolarisClipsDesktopCommentsPopoverQuery`, `26898197033164947`, `{ media_id }`
  returns `data.fetch__XDTMediaDict` summary. Feed/reels pagination is not an
  arbitrary-shortcode loader.
- Ranked comments, `top_likers`, and `facepile_top_likers` prove engagement, not
  following. `PolarisUserHoverCardContentV2Query`, `27756568060663620`,
  `{ userID }` supplies `friendship_status.following`. Join by numeric user ID,
  not timing, rank, or username. A followed commenter absent from named likers
  cannot be inferred from those liker lists.

## Evidence sources

Tracked captures in [`examples/`](examples/): `www.instagram.com.har`,
`www.instagram.com-the-second.har`, `www.instagram.com-live-communication.har`,
and `www.instagram.com-open-reel-from-chat-and-watch.har`. The last contains
media info and initial comments, not comment continuation.

Sanitized supplemental findings above came from local, untracked
`message-editing.har`, `comment-actions.har`, `real-loading*.har`,
`reel-with-following-account-comment.har`, `more-requests.har`, and a reply-jump
capture. See [capture handling](README.md#protocol-captures).
These observations are research evidence,
not guarantees of current server behavior; reverify operations before extending RPCs.
