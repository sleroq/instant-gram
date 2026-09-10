---
# icr-pdaz
title: scrollToMessage API for reply navigation
status: scrapped
type: milestone
priority: high
tags:
    - chat
    - scroll
    - replies
created_at: 2026-07-04T17:29:45Z
updated_at: 2026-08-03T13:17:25Z
blocked_by:
    - icr-kphj
---

Large-size milestone: add a scrollToMessage API that can find a target message by lazily loading older pages until the target exists, then navigate to it smoothly.

Goal:
Provide a first-class API for reply navigation and future deep-linking:
scrollToMessage(threadKey, messageId, options).

Behavior:

- If the target message is already loaded, scroll to it via the virtualizer and briefly highlight it.
- If it is not loaded, load older pages until the message is found or history ends.
- While searching, keep the user's current viewport stable unless the user explicitly initiated navigation.
- For very distant targets, avoid long animated travel through thousands of pixels: position near the target, then perform a short final smooth scroll/highlight.
- The API must be callable from user clicks and from lazy/non-interactive triggers when the user scrolls near a message that contains a reply target they may click.

Implementation notes:

- Add a small message index map: message id -> loaded array index.
- Add pending target state per thread so repeated calls coalesce.
- Add abort/race protection for selected thread changes.
- Decide UX for not found: non-blocking message or no-op with logged/debug state.
- Integrate with reply rendering work later; do not require reply UI to exist in this milestone.

Checklist:

- [x] Define scrollToMessage(threadKey, messageId, options) API shape and return status.
- [x] Add loaded message-id-to-index lookup for each thread cache entry.
- [x] Implement already-loaded path using virtualizer scrollToIndex/scrollToOffset.
- [x] Implement lazy search path that loads older pages until the id is found or hasNextPage is false.
- [x] Coalesce duplicate scroll/search requests for the same message.
- [x] Keep passive/lazy prefetch calls from stealing the user's scroll position.
- [x] Add short final animation and target highlight for explicit navigation.
- [x] Add safe not-found result handling.
- [ ] Verify with a target near viewport, a target several pages above, and a missing target.

Implementation checkpoint:

- MessageList exposes a virtualizer-backed `scrollToMessage` API.
- App implements active/passive target search by loading older pages into the non-rendered older-message buffer until found or history ends.
- Explicit reply navigation scrolls and highlights; passive lookup only resolves/cache-warms targets.
- Verified with `npm run check` and `npm run build`; browser behavior remains in manual QA.

Acceptance criteria:

- Calling scrollToMessage for a loaded message centers or reveals it smoothly.
- Calling scrollToMessage for an unloaded older message loads pages until found and then navigates without buggy teleports.
- Passive preparation for reply targets can run without moving the user's viewport.

## Disposition (2026-08-03)

Scrapped after codebase review. This describes the removed Svelte/TanStack virtualizer and a 200-message background buffer, neither of which exists nor fits the current Teact architecture. The implemented supported behavior is the normalized 40–80 row history window with one-page lookahead and anchor correction documented in `docs/frontend-architecture.md`. Reply navigation/prefetch is not an active product requirement and should be re-scoped from the current architecture if needed later.
