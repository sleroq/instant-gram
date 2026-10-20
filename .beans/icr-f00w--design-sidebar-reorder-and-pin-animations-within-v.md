---
# icr-f00w
title: Animate sidebar reorder and pin changes with physical sliding
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:51:41Z
parent: icr-i2ye
blocked_by:
    - icr-yp9o
    - icr-r54z
---

The user confirmed physical sliding when sidebar conversations reorder due to activity or pin/unpin. This is approved, not a pending choice between movement and fade/highlight. Implement a narrow visual-reorder exception to the former no-row-motion rule; do not relax layout, mount or scroll invariants.

- [ ] Slide visible, already-mounted conversations from their prior visual positions to the new ones using stable thread IDs. Update canonical order and fixed outer virtual-slot placement immediately; keep any interpolated presentation transform separate from the virtualizer's positioning transform.
- [ ] Preserve fixed 72px rows, at most 31 mounted rows, correct hit targets, selection/focus and logical list position. Do not add offscreen rows or duplicate interactive clones merely to animate a reorder.
- [ ] Cover activity reorder and pin/unpin in expanded and icons-only modes. Initial mount, scrolling/recycling, sidebar resize/folding, history layout and anchor corrections do not receive this exception.
- [ ] Use icr-r54z's shared System/Reduced/Full gate; effective Reduced applies final positions immediately. State, mutation settlement and focus must not wait for decorative motion.
- [ ] Handle rapid successive reorders cleanly and test viewport boundaries, stable identity, geometry, reduced motion and disposal. Use a concrete bounded implementation, not a generic animation framework.

Depends on icr-yp9o and icr-r54z. This is appearance over existing durable R2 pins, not a duplicate of the R3 menu migration icr-7zgg. Motion documentation must carry this scoped exception; no UI animation has been implemented by triage.
