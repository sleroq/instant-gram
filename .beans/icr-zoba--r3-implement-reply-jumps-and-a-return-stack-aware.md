---
# icr-zoba
title: 'R3: Implement reply jumps and a return-stack-aware newest control'
status: todo
type: feature
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:49:38Z
parent: icr-jce7
blocked_by:
    - icr-i2ye
    - icr-mwu8
---

Own reply navigation under icr-jce7. Extend the existing icr-mwu8 floating button; keep return positions window-local and history reads worker-owned.

- [ ] Search mounted/cached history first, then request worker-owned serial older opaque cursors until target found, exhausted or failed. Report page/message progress honestly, prioritize explicit intent and bound nearby prefetch to the documented four targets/one page each.
- [ ] Focus/highlight a bounded exact target window and push the prior per-window, per-thread logical ID-plus-offset position. Preserve the prior coverage proof needed to restore it safely; no inferred around-message endpoint.
- [ ] Make the floating down/return button and documented Ctrl+O path pop reply-return positions before going newest. Nested A-to-B-to-C reply jumps return C-to-B-to-A before an empty stack permits bottom navigation; do not discard the stack merely because new messages arrive.
- [ ] Keep the incoming-message badge visible/accurate through return operations; returning to an older position does not clear it. Only actually reaching/seeing newest updates its baseline. icr-j8fk must not hijack an older reply target or mistake a bounded window's bottom for latest-follow intent.
- [ ] Cover return anchors/coverage after refresh, missing/deleted targets, cancellation, account/route changes, keyboard/focus and no unintended fetches during local navigation.

This is the prerequisite for promising full reply-history-aware button behavior, not an extra pre-R3 blocker.
