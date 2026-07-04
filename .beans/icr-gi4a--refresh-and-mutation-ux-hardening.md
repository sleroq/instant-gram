---
# icr-gi4a
title: Refresh and mutation UX hardening
status: todo
type: milestone
priority: normal
tags:
    - dm
    - ux
created_at: 2026-07-04T16:58:23Z
updated_at: 2026-07-04T16:58:23Z
blocked_by:
    - icr-4an3
    - icr-5say
---

Large milestone for making send/reply/reaction mutations feel reliable in the absence of decoded Instagram live updates.

## Scope
Harden refresh, de-dupe, failure, and manual QA paths after sending and reacting.

## Checklist
- [ ] Refresh the active thread after successful send/reaction and de-dupe by stable server message id plus local pending metadata.
- [ ] Preserve scroll position when viewing older messages and only jump to bottom for active-bottom send flows.
- [ ] Update thread list last-message snippets after successful sends and active-thread refreshes.
- [ ] Centralize pending/failed mutation state so message bubbles, composer, and thread cache agree.
- [ ] Add clear retry/remove behavior for failed sends and failed reactions.
- [ ] Document manual QA steps for sending, replying, reacting, refresh, and auth failure recovery.
- [ ] Verify with `npm run check` and a full manual pass across at least two threads.

## Notes
Do not attempt MQTT/live websocket integration in this milestone. Polling or active-thread refresh is the intended first implementation path.
