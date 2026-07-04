---
# icr-kphj
title: Lazy older-message buffer above viewport
status: todo
type: milestone
priority: high
tags:
    - chat
    - scroll
    - preload
created_at: 2026-07-04T17:29:19Z
updated_at: 2026-07-04T17:29:19Z
blocked_by:
    - icr-03bb
---

Large-size milestone: preload a deep older-message buffer lazily while the user remains below the history boundary.

Goal:
Maintain a target buffer of older messages above the current viewport, roughly 500 messages when available, without requiring the user to hit the top of the list.

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
- [ ] Add constants for target older-message buffer and preload batch limits.
- [ ] Track visible virtual range and count loaded messages before it.
- [ ] Implement ensureOlderBuffer(threadKey) that fetches older pages until the target is satisfied or history ends.
- [ ] Trigger ensureOlderBuffer after initial load, scroll range changes, and each older-page merge.
- [ ] Prevent duplicate concurrent older-page requests per thread.
- [ ] Preserve viewport anchor during background prepends.
- [ ] Expose loading/preloading state distinctly enough for UI/debugging without adding noisy user-facing loaders.
- [ ] Verify that scrolling upward into preloaded history does not require immediate network fetches in the common case.

Acceptance criteria:
- When a thread has enough history, the app lazily loads about 500 messages above the visible range.
- User can continue reading while background older-page loads happen with no visible jump.
- Preload stops cleanly at the oldest page or when switching threads.
