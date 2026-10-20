---
# icr-dtee
title: 'R3: Animate reactions and context-menu open and close'
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-jce7
blocked_by:
    - icr-njy9
    - icr-u9ok
    - icr-r54z
---

Add the requested like/reaction and popup-menu motion only after their real surfaces exist: icr-njy9 and icr-u9ok. Use the shared System/Reduced/Full gate from icr-r54z; never build a placeholder popup merely to animate it.

- [ ] Give message-heart/reaction changes bounded visual feedback without replaying on stale reads, cached remounts or receipt echo, and without changing optimistic rollback or durable settlement semantics.
- [ ] Animate concrete context-menu open/close with transform/opacity; dismiss, restore focus and handle reopen-during-close correctly. Reduced settles immediately and does not leave an invisible intercepting surface or timer-delayed focus.
- [ ] Keep pointer, touch, keyboard, long-press cancellation, viewport clamping and rapid repeated input correct. Do not introduce a generic animation/retained-exit framework for theoretical future surfaces.
- [ ] Verify shared gate changes during motion and cleanup on route/account teardown. Leave row positions, layout and scroll maintenance unanimated.

This owns the applicable lifecycle integration for R3 surfaces; R4 modal/media-like motion must reuse the same owner when those separate features exist.
