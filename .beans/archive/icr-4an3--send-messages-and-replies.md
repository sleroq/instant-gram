---
# icr-4an3
title: Send messages and replies
status: scrapped
type: milestone
priority: high
tags:
    - dm
    - sending
created_at: 2026-07-04T16:57:56Z
updated_at: 2026-08-03T13:35:41Z
---

Add plain-message and reply sending to the current TypeScript/Teact UI.

## Verified current state

There is no composer, send RPC, mutation route, or pending-message state. The documented `IGDirectTextSendMutation` request is recorded in `docs/instagram-live-communication.md`; current message replies already render read-only.

## Scope

- Add `sendText({ threadKey, text, replyToMessageId? })` through domain, typed UI RPC, background, and anchor.
- Build an accessible Teact composer with Enter-to-send, Shift+Enter newline, reply context, cancel, and failed-send retry/remove controls.
- Optimistically insert pending messages, reconcile/de-duplicate on success, and preserve user position unless sending from the bottom.
- Keep Instagram protocol details out of `App.tsx`.



## Disposition

Merged into `icr-9qjx`, which now owns the complete mutation contract, optimistic send/reply state, composer UX, reconciliation, scrolling, and verification. Keeping this as a separate milestone would split one behavioral boundary and duplicate acceptance criteria.
