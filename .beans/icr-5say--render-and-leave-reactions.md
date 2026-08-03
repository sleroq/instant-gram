---
# icr-5say
title: Render and leave reactions
status: todo
type: milestone
priority: high
tags:
    - dm
    - reactions
created_at: 2026-07-04T16:58:10Z
updated_at: 2026-08-03T13:17:24Z
blocked_by:
    - icr-9qjx
---

Render structured reactions and let a user create or change one from the current TypeScript/Teact UI.

## Verified current state

`REACTION_LOG_XMAT` history rows are intentionally omitted by the parser and no structured reaction fields, mutation RPC, or message-level reaction UI exists. The documented create/change request is available in `docs/instagram-live-communication.md`; removal still lacks HAR evidence.

## Scope

- Inspect a live/HAR payload for structured reaction fields and extend `Message` parsing/domain types.
- Render grouped emoji counts and viewer state in Teact message rows.
- Add an accessible message action and small fixed emoji picker (`❤ 😂 😮 😢 😡 👍`).
- Route `sendReaction({ threadKey, messageId, emoji })` through domain, UI RPC, background, and anchor using the documented create/change mutation.
- Optimistically update local state and reconcile failure. Do not implement removal without a confirmed request shape.
