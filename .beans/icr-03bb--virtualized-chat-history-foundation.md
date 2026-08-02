---
# icr-03bb
title: Virtualized chat history foundation
status: scrapped
type: milestone
priority: high
tags:
    - chat
    - scroll
    - virtualization
created_at: 2026-07-04T17:28:57Z
updated_at: 2026-08-02T23:18:33Z
---

Large-size milestone: introduce TanStack virtual scrolling as the foundation for stable long chat history.

Goal:
Replace direct DOM rendering of all loaded messages with a virtualized message list that preserves visual anchors while older pages are prepended and supports large lazy history buffers.

Why:
The current message list manually restores scrollTop after prepending older messages, which can still jump due to async rendering, loader height changes, image sizing, and future far-history reply jumps. Virtualization gives stable offsets, bounded DOM size, and a natural API for scrolling to loaded messages by id/index.

Implementation notes:

- Add TanStack Virtual for Svelte after confirming the package name/version and Svelte 5 usage.
- Keep message identity keyed by message.id.
- Measure dynamic row heights; reserve known media dimensions where possible.
- Keep history loader outside unstable measured message rows or give it deterministic sizing.
- Preserve current behavior for selecting threads and jumping to bottom.

Checklist:

- [x] Verify TanStack Virtual Svelte package/API and add dependency.
- [x] Refactor MessageList.svelte so message row rendering is separable from list virtualization.
- [x] Replace direct {#each entry.data.items} rendering with virtual rows and overscan.
- [x] Add row measurement keyed by message id for dynamic message heights.
- [x] Preserve initial scroll-to-bottom behavior for newly opened threads.
- [ ] Preserve per-thread scroll restoration using virtualizer anchor/index state rather than raw scrollTop alone.
- [x] Ensure prepending older pages does not visually move the current viewport.
- [x] Run typecheck/build verification.

Acceptance criteria:

- Loading older messages while reading does not visibly jump.
- A thread with hundreds of loaded messages renders only a bounded DOM window.
- Existing open reel and jump-to-bottom interactions still work.



Superseded by the Teact rewrite in docs/frontend-rewrite-plan.md. The Svelte/TanStack implementation was removed; its remaining behavioral requirements are carried by Milestone 2 of that plan.
