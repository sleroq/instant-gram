# Instagram DM MVP methods

Source captures: `www.instagram.com.har`, `www.instagram.com-the-second.har`. Values below omit live auth tokens; use the current page's harvested `fb_dtsg`, `lsd`, `jazoest`, `csrftoken`, `device_id_for_iris_subscription`, and viewer FBID. All rows except `getReelMedia` are HAR-backed; `getReelMedia` is carried over from the plan because the HARs contain reel-share XMA data but not the video lookup request. See `instagram-har-useful-requests.md` for copyable request examples.

## Common request shape

- POST form body to `https://www.instagram.com/api/graphql` unless noted.
- Required body fields: `__d=www`, `__a=1`, `__comet_req=7`, `dpr=2`, `fb_api_caller_class=RelayModern`, `fb_api_req_friendly_name`, `server_timestamps=true`, `variables`, `doc_id`, plus current `fb_dtsg`, `lsd`, `jazoest`.
- Required headers seen in both HARs: `content-type: application/x-www-form-urlencoded`, `x-ig-app-id: 936619743392459`, `x-asbd-id: 359341`, `x-fb-lsd`, `x-fb-friendly-name`, `x-csrftoken`.

## Methods to implement

| method | friendly name | doc_id | variables | response path |
|---|---:|---:|---|---|
| `getInbox` | `PolarisDirectInboxQuery` | `27262915580045003` | `{ device_id_for_iris_subscription, __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider:false, __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider:true, __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider:5, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false, __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider:false }` | `data.get_slide_mailbox_for_iris_subscription.threads_by_folder` |
| `getInboxPage` | `IGDThreadListOffMsysPaginationQuery` | `27712934271665380` | `{ count:5, cursor, folder:'INBOX', newer_than_timestamp_ms:null, id:viewer_fbid, same GK flags as inbox }` | `data.fetch__SlideMailbox.threads_by_folder` |
| `getThreadHeader` | `IGDInboxHeaderOffMsysQuery` | `27358538347096449` | `{ thread_fbid, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }` | `data.get_slide_thread_nullable.as_ig_direct_thread` |
| `getThread` | `IGDThreadDetailQuery` | `27852254574460474` | `{ thread_fbid, __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider:false, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20, __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider:false }` | `data.get_slide_thread_nullable.as_ig_direct_thread.slide_messages` |
| `getOlderMessages` | `IGDMessageListOffMsysQuery` | `25255103937520139` | `{ after:end_cursor, before:null, first:20, last:null, newer_than_message_id:null, older_than_message_id:null, id:thread_fbid, __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:20 }` | `data.fetch__SlideThread.as_ig_direct_thread.slide_messages` |
| `getReelMedia` | `PolarisPostActionLoadPostQueryQuery` | `8845758582119845` | `{ shortcode, fetch_tagged_user_count:null, hoisted_comment_id:null, hoisted_reply_id:null }` to `/graphql/query` | `data.xdt_shortcode_media.video_url` |

## Parser notes

- Inbox threads live in `threads_by_folder.edges[].node.as_ig_direct_thread`; use `threads_by_folder.page_info.end_cursor/has_next_page` for inbox pagination.
- Thread messages live in `slide_messages.edges[].node`; use `slide_messages.page_info.end_cursor/has_next_page` for older-message pagination.
- Text messages are `content_type: 'TEXT'` with `content.__typename: 'SlideMessageText'` and `text_body`.
- Reel/post shares are `content_type: 'MESSAGE_INLINE_SHARE'` with `content.__typename: 'SlideMessageXMAContent'`; reel shares have `content.xma.__typename: 'SlideMessagePortraitXMA'`, `target_url` like `/reel/<shortcode>/...`, and `preview_image.url` for the thumbnail. Some shares are `SlideMessageStandardXMA` posts or `SlideMessagePlaceholderXMA` unavailable content.
- Replies are embedded as `replied_to_message`; they can contain the same text/XMA shapes as normal messages.
