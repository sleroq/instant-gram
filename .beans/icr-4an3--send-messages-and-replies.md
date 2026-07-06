---
# icr-4an3
title: Send messages and replies
status: todo
type: milestone
priority: high
tags:
    - dm
    - sending
created_at: 2026-07-04T16:57:56Z
updated_at: 2026-07-04T16:57:56Z
blocked_by:
    - icr-9qjx
    - icr-3br2
---

Large milestone for sending plain messages and replying to existing messages from the custom DM UI.

## Scope

Add the composer, send mutation RPC, optimistic local state, and reply-send flow.

## Checklist

- [ ] Add `sendText({ threadKey, text, replyToMessageId? })` to `RpcMap`, background routing, and anchor content script handlers.
- [ ] Implement `IGDirectTextSendMutation` using doc id `26911679871773184` and variables from `docs/instagram-live-communication.md`.
- [ ] Add `MessageComposer.svelte` with textarea, send button, Enter-to-send, and Shift+Enter newline.
- [ ] Add selected reply state and a reply target affordance on message bubbles.
- [ ] Show selected reply context above the composer and allow canceling it.
- [ ] Optimistically insert pending local messages and replace/refresh/de-dupe after mutation success.
- [ ] Mark failed sends with retry/cancel controls without losing typed text or reply target.
- [ ] Preserve scroll-to-bottom behavior only when the user is already at the bottom.
- [ ] Verify with `npm run check` and manual send/reply QA.

## Notes

Use `reply_to_message_id` for replies; keep `replied_to_client_context` and `replied_to_item_id` null as documented.
