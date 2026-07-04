# Useful HAR request examples

Sanitized extracts from `examples/www.instagram.com.har` and `examples/www.instagram.com-the-second.har`. Auth/session fields are intentionally placeholders; fill them from the live Instagram anchor tab before replaying.

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

Source: `examples/www.instagram.com-the-second.har`, entry `44`. This was the missing request in the original plan.

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

The HARs do not include the reel video lookup request, but they do include many DM reel shares. Parse these from `IGDThreadDetailQuery` / `IGDMessageListOffMsysQuery` message nodes:

```txt
node.content_type = MESSAGE_INLINE_SHARE
node.content.__typename = SlideMessageXMAContent
node.content.xma.__typename = SlideMessagePortraitXMA
node.content.xma.target_url = https://www.instagram.com/reel/<shortcode>/?...
node.content.xma.preview_image.url = <thumbnail CDN URL>
node.content.xma.header_title_text = <author username/name when present>
node.content.xma.title_text or caption_body_text = <caption-ish text when present>
```

Use the shortcode from `target_url` with the plan's `PolarisPostActionLoadPostQueryQuery` `/graphql/query` call, but verify that live once because it was not present in these HAR captures.
