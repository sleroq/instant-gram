---
# icr-5npn
title: Reply-target prefetch and UX integration
status: in-progress
type: milestone
priority: normal
tags:
    - chat
    - replies
    - preload
created_at: 2026-07-04T17:30:15Z
updated_at: 2026-07-04T17:54:51Z
blocked_by:
    - icr-pdaz
---

Large-size milestone: prepare reply-target navigation before the user clicks by lazily resolving likely target messages during normal reading.

Goal:
When visible messages include replies to older messages, opportunistically prepare those reply targets so a later click feels instant or near-instant.

Why:
The desired reply feature should feel seamless even when the target is far back in history. Since scrollToMessage can load all older pages until a target is found, we should trigger this work lazily and passively for likely user actions rather than waiting for the click.

Implementation notes:
- This should build on the scrollToMessage API but use a passive mode that never moves the viewport.
- Prioritize reply targets from visible and near-visible messages.
- Limit concurrency and total passive work so reading a thread does not trigger excessive network fetches.
- Cache found/missing target status per thread/message id.
- Connect to existing/planned reply rendering milestone icr-3br2 when reply UI is implemented.

Checklist:
- [x] Detect visible/near-visible messages that have repliedTo ids once reply rendering exposes them.
- [x] Add passive prepareMessageTarget(threadKey, messageId) built on scrollToMessage search internals without scrolling.
- [x] Prioritize nearest visible reply targets and dedupe repeated target ids.
- [x] Add concurrency/rate limits for passive target preparation.
- [x] Cache target resolution status: loaded, found after fetch, not found, pending.
- [x] Wire explicit reply click to scrollToMessage with animation/highlight.
- [x] Ensure passive preparation does not fight the 200-message older-buffer preload loop.
- [ ] Verify explicit reply click is fast when passive preparation has already resolved the target.

Implementation checkpoint:
- Visible virtual reply rows report their `repliedTo` ids to App.
- App passively resolves one target at a time into the non-rendered older-message buffer and caches pending/found/missing state per thread.
- Reply preview is clickable and uses active `scrollToMessage` with highlight.
- Verified with `npm run check` and `npm run build`; speed/smoothness needs manual browser testing.

Acceptance criteria:
- Visible reply messages can passively prepare their targets without moving the viewport.
- Clicking a prepared reply target navigates immediately with a short smooth motion/highlight.
- Passive work is bounded and does not flood older-page requests.
