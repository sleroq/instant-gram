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
updated_at: 2026-07-04T16:58:10Z
blocked_by:
    - icr-9qjx
---

Large milestone for structured reactions, emoji selection, and creating/changing reactions from the UI.

## Scope

Render reactions on messages and support creating/changing reactions with a small emoji picker.

## Checklist

- [ ] Inspect live/HAR message payloads enough to identify structured reaction fields and update parser accordingly.
- [ ] Add `MessageReaction` domain type and group reactions by emoji for display.
- [ ] Extract `ReactionBar.svelte` to show grouped emoji counts and whether the viewer reacted.
- [ ] Add message-level reaction trigger and a fixed first-pass emoji picker: `❤ 😂 😮 😢 😡 👍`.
- [ ] Add `sendReaction({ threadKey, messageId, emoji })` to `RpcMap`, background routing, and anchor content script handlers.
- [ ] Implement `IGDirectReactionSendMutation` using doc id `24374451552236906` with `reaction_status: "created"`.
- [ ] Optimistically update local reactions and rollback or refresh on failure.
- [ ] Do not implement reaction removal until a HAR/live sample confirms the correct request shape.
- [ ] Verify with `npm run check` and manual reaction QA.

## Notes

Existing `reaction_log` messages can remain as activity logs until structured reactions are reliable; avoid using them as the source of truth for bubble reactions.
