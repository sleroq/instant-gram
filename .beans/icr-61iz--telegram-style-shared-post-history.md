---
# icr-61iz
title: Telegram-style shared-post history
status: completed
type: milestone
priority: high
tags:
    - history
    - reels
    - reactions
    - discovered
created_at: 2026-08-06T14:47:29Z
updated_at: 2026-08-06T15:07:19Z
---

Rework shared-post/reel rows in chat history into a Telegram-inspired presentation: media-forward, compact metadata, external reactions, hover-only timestamp, and media readiness before opening.

The current implementation has the needed normalized history/reel stores and bounded 80-row rendering. It already preloads reel media (two concurrent starts, eight starts per store lifetime), but inline previews autoplay near the viewport and comments load only after modal open. The existing message bubble wraps posts, embeds reaction chips, and reserves body width for an always-present timestamp.

Comments remain deliberately lazy: opening a post requests the initial comment page only after media resolves.

Dependencies/order: post layout establishes the target DOM geometry; reaction controls follow it; readiness work can proceed independently but must preserve the same normalized store and preload single-flight invariants.

Acceptance: shared posts have no post-card/bubble border or unused right/bottom space; author identity is compact and truncated; reactions sit below content; time appears only on hover/focus inside the bottom-right of the post; preview videos do not autoplay; opening a visible/near-visible post uses cached or already-queued media without duplicate requests.


Completed 2026-08-06: all child requirements implemented. Shared posts are media-forward and space-efficient, reactions use the accessible rail/full chooser, timestamps are contextual overlays, and bounded store-owned media readiness avoids autoplay and duplicate open requests. Architecture documentation and focused store/browser regressions were updated; prescribed frontend verification passes.

Manual-feedback remediation preserves true portrait media ratios, progressively
expands quick reactions from one default control, toggles placed reactions with
store-owned optimistic revoke/add semantics, and loads reel-author avatars
through a bounded trusted background proxy. Sidebar lost-pointer-capture and
unmount cleanup remains idempotent and covered by the production harness.
