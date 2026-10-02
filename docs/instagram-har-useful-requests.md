# Useful HAR request examples

**Status: protocol reference, NOT current runtime capabilities.** The production closed provider exposes only reads defined by [the engine contract](engine-inbox-contract.md). Media, engagement, and mutations are references for future R2–R5, not implemented UI features.

Sanitized request extracts from tracked captures under `docs/examples`, including `examples/www.instagram.com.har` and `examples/www.instagram.com-the-second.har`. Other named captures below are local and untracked; only sanitized descriptions are recorded here. Auth/session fields are intentionally placeholders; replay requires current credentials from the live Instagram anchor tab.

## Common POST form fields

Use these for every GraphQL request below, then add that request's `fb_api_req_friendly_name`, `doc_id`, and `variables`.

```txt
__d=www
__a=1
__comet_req=7
dpr=2
fb_api_caller_class=RelayModern
server_timestamps=true
fb_dtsg=<live fb_dtsg>
lsd=<live lsd>
jazoest=<live jazoest>
```

Common headers:

```txt
content-type: application/x-www-form-urlencoded
x-ig-app-id: 936619743392459
x-asbd-id: 359341
x-fb-lsd: <live lsd>
x-fb-friendly-name: <same as fb_api_req_friendly_name>
x-csrftoken: <live csrftoken cookie>
```

## 1. Initial inbox

Source: `examples/www.instagram.com.har`, entry `3` and `examples/www.instagram.com-the-second.har`, entry `3`.

```txt
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name=PolarisDirectInboxQuery
doc_id=27262915580045003
```

```json
{
    "device_id_for_iris_subscription": "<live device_id_for_iris_subscription>",
    "__relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider": false,
    "__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider": true,
    "__relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider": 5,
    "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": false,
    "__relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider": false
}
```

Response to parse:

```txt
data.get_slide_mailbox_for_iris_subscription.threads_by_folder.edges[].node.as_ig_direct_thread
data.get_slide_mailbox_for_iris_subscription.threads_by_folder.page_info.end_cursor
data.get_slide_mailbox_for_iris_subscription.threads_by_folder.page_info.has_next_page
```

## 2. Inbox pagination

Source: `examples/www.instagram.com-the-second.har`, entry `44`.

```txt
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name=IGDThreadListOffMsysPaginationQuery
doc_id=27712934271665380
```

```json
{
    "count": 5,
    "cursor": "<threads_by_folder.page_info.end_cursor from getInbox/getInboxPage>",
    "folder": "INBOX",
    "newer_than_timestamp_ms": null,
    "id": "<viewer_fbid>",
    "__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider": true,
    "__relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider": 5,
    "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": false,
    "__relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider": false
}
```

Response to parse:

```txt
data.fetch__SlideMailbox.threads_by_folder.edges[].node.as_ig_direct_thread
data.fetch__SlideMailbox.threads_by_folder.page_info.end_cursor
data.fetch__SlideMailbox.threads_by_folder.page_info.has_next_page
```

## 3. Thread header

Source: `examples/www.instagram.com.har`, entries `8`, `57`; `examples/www.instagram.com-the-second.har`, entry `8`.

```txt
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name=IGDInboxHeaderOffMsysQuery
doc_id=27358538347096449
```

```json
{
    "thread_fbid": "<thread_fbid>",
    "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": false
}
```

Response to parse:

```txt
data.get_slide_thread_nullable.as_ig_direct_thread
```

## 4. Initial thread messages

Source: `examples/www.instagram.com.har`, entry `9`; `examples/www.instagram.com-the-second.har`, entry `9`.

```txt
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name=IGDThreadDetailQuery
doc_id=27852254574460474
```

```json
{
    "thread_fbid": "<thread_fbid>",
    "__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider": false,
    "__relay_internal__pv__IGDInitialMessagePageCountrelayprovider": 20,
    "__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider": false
}
```

Response to parse:

```txt
data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages.edges[].node
data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages.page_info.end_cursor
data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages.page_info.has_next_page
```

## 5. Older thread messages

Source: `examples/www.instagram.com.har`, entry `67`.

```txt
POST https://www.instagram.com/api/graphql
fb_api_req_friendly_name=IGDMessageListOffMsysQuery
doc_id=25255103937520139
```

```json
{
    "after": "<slide_messages.page_info.end_cursor from getThread/getOlderMessages>",
    "before": null,
    "first": 20,
    "last": null,
    "newer_than_message_id": null,
    "older_than_message_id": null,
    "id": "<thread_fbid>",
    "__relay_internal__pv__IGDInitialMessagePageCountrelayprovider": 20
}
```

Response to parse:

```txt
data.fetch__SlideThread.as_ig_direct_thread.slide_messages.edges[].node
data.fetch__SlideThread.as_ig_direct_thread.slide_messages.page_info.end_cursor
data.fetch__SlideThread.as_ig_direct_thread.slide_messages.page_info.has_next_page
```

## 6. Reel-share fields inside message responses

The DM HARs include many reel shares. Parse these from `IGDThreadDetailQuery` / `IGDMessageListOffMsysQuery` message nodes:

```txt
node.content_type = MESSAGE_INLINE_SHARE
node.content.__typename = SlideMessageXMAContent
node.content.xma.__typename = SlideMessagePortraitXMA
node.content.xma.target_url = https://www.instagram.com/reel/<shortcode>/?...
node.content.xma.preview_image.url = <thumbnail CDN URL>
node.content.xma.header_title_text = <author username/name when present>
node.content.xma.title_text or caption_body_text = <caption-ish text when present>
```

The separate `examples/www.instagram.com-open-reel-from-chat-and-watch.har`
captures the browser's follow-up media reads:

```txt
lines 3126–3139: GET /api/v1/media/<media-id>/info/
line 3389: response items[0].pk = <media-id> and
           items[0].id = <media-id>_<owner-id>
lines 1434–1447: GET /api/v1/media/<media-id>/comments/
                 ?can_support_threading=true&permalink_enabled=false
```

The capture proves the initial comments request and response shape, but contains
no comments request with `min_id`; do not infer pagination from `next_min_id`.
The later sanitized `real-loading` captures prove that Instagram's URL-safe
base64 shortcode decodes to the same numeric media ID used by comments and the
REST info path. Prefer a numeric DM media-ID hint and use that deterministic
decode only when the hint is absent in a future media loader. Validate REST
`items[0].pk` and `items[0].code` before caching media.

## 7. Followed-account engagement social context

`reel-with-following-account-comment.har` captures the same media ID in two
authenticated REST reads:

```txt
GET /api/v1/media/<media-id>/comments/
    ?can_support_threading=true&permalink_enabled=false
GET /api/v1/media/<media-id>/info/
```

The comments response is base64-encoded in the HAR. After decoding, the root has
`is_ranked: true`; comment `<comment-id>` has `comment_index: 0`,
`is_ranked_comment: true`, its text, and a complete user identity including
username `<engaged-username>`, numeric user ID `<engaged-user-id>`, and
`profile_pic_url`. The response does **not** include `user.friendship_status`
or another following flag, so ranking alone does not prove the requested cue.

The info response separately has `top_likers: ["<engaged-username>"]` and a matching
`facepile_top_likers` user with the same numeric ID. `social_context` and
`preview_comments` are both empty. Those two REST responses prove like and
comment engagement by the same account, but still not viewer-following.

`more-requests.har` captures the missing correlation in the same navigation.
The comments and info reads start at `<comments-time>` and `<info-time>`. At
`<engaged-hover-time>`, request `PolarisUserHoverCardContentV2Query` uses document
`27756568060663620` with `{"userID":"<engaged-user-id>"}`. Its response
returns the same `pk`/username and `friendship_status.following: true`. A second
hover-card request at `<author-hover-time>` targets media author `<author-user-id>` and
returns `following: false`; it must not be correlated to the comment merely
because it occurs nearby. The numeric user IDs, not timing or rank, join the
three responses.

A proposed future enrichment could take the first five ordered
`top_likers`/facepile matches, execute the captured user-ID query for each after
media info, and include only accounts whose response IDs match and whose
`following` value is exactly true. The ranked index-zero comment cue would also
require one of those proven account IDs. This would bound enrichment to five
lookups per media load; it is NOT implemented UI behavior. A followed commenter
who is not also a named top liker remains undetectable from these captures and
must not be inferred.
