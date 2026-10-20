---
# icr-mwu8
title: Add a floating newest button with a new-message badge
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-i2ye
blocked_by:
    - icr-j8fk
---

Add a floating down/newest control for the current chat, clear of the input/Send clouds, when the reader is away from the logical newest position. This is the navigation replacement for the removed Show latest messages text, not a routine refresh button.

- [ ] Use icr-j8fk and existing worker cached-newer/current-head selection to reach newest without expanding the mounted history window or fabricating cursor continuity. Preserve keyboard access, focus and reduced-motion behavior.
- [ ] Show the number of new incoming messages since this window left the bottom using stable canonical IDs and a per-window seen baseline. Deduplicate polling/echoes, exclude own sends from incoming counts and do not confuse this number with the account/server unread total.
- [ ] Across a gap or an unobserved interval, expose partial/unknown count honestly rather than treating a boolean flag or truncated projection as an exact total. icr-fscs later provides authoritative count metadata; ordinary button navigation must not wait for that future capability.
- [ ] Reaching and actually viewing newest updates the per-window baseline; selecting a thread or fetching history alone does not clear unread state or mark invisible messages read.
- [ ] Keep one control/action entry point for R3's reply-return stack. Before reply navigation exists the stack is empty; the R3 follow-up must pop saved reply positions first rather than always jump to bottom.
- [ ] Cover appearance/disappearance, incoming badge updates, disjoint coverage, compact layout and exact scroll/focus restoration.

The basic control is current polish; stack-aware reply navigation is explicitly future R3 work.
