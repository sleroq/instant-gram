---
# icr-yp9o
title: Fold the conversation sidebar into an accessible icons-only rail
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:49:38Z
parent: icr-i2ye
blocked_by:
    - icr-omoc
---

Add an explicit collapse/expand action for the existing conversation sidebar. Collapsed mode shows conversation icons/avatars rather than full row text; this is not a generic multi-destination navigation rail.

- [ ] Keep selected-conversation indication, accessible conversation names/tooltips, keyboard navigation, future unread badges and compact-screen Back behavior usable in both modes.
- [ ] Preserve fixed 72px inbox slots and at most 31 mounted rows. Switching modes must retain logical list position/focus and the selected chat's draft/history anchor without resubscribing or remounting history unnecessarily.
- [ ] Preserve the expanded resize width and valid min/max bounds; collapsed mode must coexist with the invisible separator from icr-omoc. Do not animate virtual row placement or layout.
- [ ] Keep geometry window-local unless a persistence choice is explicitly added through icr-r54z; do not introduce a second preference store.
- [ ] Cover fold/unfold, selection, resize, keyboard, long labels and desktop/compact transitions.
