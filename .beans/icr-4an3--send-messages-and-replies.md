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
updated_at: 2026-08-03T13:17:24Z
blocked_by:
    - icr-9qjx
    - icr-3br2
---

Add plain-message and reply sending to the current TypeScript/Teact UI.

## Verified current state

There is no composer, send RPC, mutation route, or pending-message state. The documented `IGDirectTextSendMutation` request is recorded in `docs/instagram-live-communication.md`; current message replies already render read-only.

## Scope

- Add `sendText({ threadKey, text, replyToMessageId? })` through domain, typed UI RPC, background, and anchor.
- Build an accessible Teact composer with Enter-to-send, Shift+Enter newline, reply context, cancel, and failed-send retry/remove controls.
- Optimistically insert pending messages, reconcile/de-duplicate on success, and preserve user position unless sending from the bottom.
- Keep Instagram protocol details out of `App.tsx`.
