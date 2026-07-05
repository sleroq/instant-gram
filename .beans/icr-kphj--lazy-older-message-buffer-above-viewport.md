---
# icr-kphj
title: Lazy older-message buffer above viewport
status: in-progress
type: milestone
priority: high
tags:
    - chat
    - scroll
    - preload
created_at: 2026-07-04T17:29:19Z
updated_at: 2026-07-04T17:41:57Z
blocked_by:
    - icr-03bb
---

Large-size milestone: preload a deep older-message buffer lazily while the user remains below the history boundary.

Goal:
Maintain a target buffer of older messages above the current viewport, roughly 200 messages for now when available, without requiring the user to hit the top of the list.

Why:
Reply navigation and smooth upward browsing need old messages to already be present before the user asks for them. The current TOP_PRELOAD_BUFFER_PX trigger only loads when the user is already near the top, which is too late for seamless interactions.

Implementation notes:
- Introduce a preload controller separate from scroll event handlers.
- Use throttled/debounced scroll state from the virtualizer to determine how many loaded messages exist above the viewport.
- Fetch pages until the older-buffer target is met, a request is already in flight, or the thread has no older cursor.
- Preserve anchor on every background prepend.
- Avoid blocking user interactions while preloading.
- Keep request cancellation/race checks for selected thread changes.

Checklist:
- [x] Add constants for target older-message buffer and preload batch limits.
- [x] Track visible virtual range and count loaded messages before it.
- [x] Implement ensureOlderBuffer(threadKey) that fetches older pages until the target is satisfied or history ends.
- [x] Trigger ensureOlderBuffer after initial load, scroll range changes, and each older-page merge.
- [x] Prevent duplicate concurrent older-page requests per thread.
- [x] Preserve viewport anchor during background prepends.
- [x] Expose loading/preloading state distinctly enough for UI/debugging without adding noisy user-facing loaders.
- [x] Verify that scrolling upward into preloaded history does not require immediate network fetches in the common case.

Implementation checkpoint:
- MessageList reports the first visible virtual message index to App.
- App maintains a 200-message older buffer above the visible range when history is available.
- Background preloads fetch into `bufferedOlder` and do not mutate rendered `data.items`, so passive network loads cannot change scroll height or virtual indexes.
- Replaced spacer staging with Telegram-style anchor-preserved prepends: passive preload remains buffer-only, top scroll prepends one chunk while preserving a stable visible DOM anchor, and range/scroll callbacks are suppressed during restoration.
- Explicit reply navigation prepends buffered chunks until the target is rendered, then scrolls to the target.
- Verified with `npm run check` and `npm run build`; manual browser/network behavior still belongs to the QA milestone.

Acceptance criteria:
- When a thread has enough history, the app lazily loads about 200 messages above the visible range.
- User can continue reading while background older-page loads happen with no visible jump.
- Preload stops cleanly at the oldest page or when switching threads.
