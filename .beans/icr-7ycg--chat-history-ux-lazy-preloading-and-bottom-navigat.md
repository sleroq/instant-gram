---
# icr-7ycg
title: 'Chat history UX: lazy preloading and bottom navigation'
status: completed
type: milestone
priority: high
tags:
    - chat-history
    - preload
    - ux
created_at: 2026-07-04T16:31:58Z
updated_at: 2026-07-04T16:52:13Z
blocked_by:
    - icr-zmst
---

Large milestone for making history loading automatic and adding navigation back to the latest messages.

Context:
- Backend already supports older-message pagination through `getThread` with cursor.
- Current UI exposes a manual `Load older` button and does not preload before the user reaches the top.
- Users need a down-arrow button to return to the bottom/latest messages.
- Follow-up tweak: preload should start much earlier than the first implementation. The UI now starts loading when the user is within 12000px of the oldest loaded message, which pulls several more pages in the background before the user reaches loaded history. Older-page prepends restore the first visible message by DOM anchor instead of scroll-height delta, so loader rows and layout changes do not shift the viewport.

Checklist:
- [x] Replace or supplement manual `Load older` with a lazy preload trigger near the top of the message list.
- [x] Trigger older-page load when scroll is within an early threshold, for example `scrollTop < 600`.
- [x] Guard lazy loading with `hasNextPage`, `loadingOlder`, and ready cache state.
- [x] Show a small top loading indicator without replacing existing messages.
- [x] Add a floating down-arrow button when the active chat is not at bottom.
- [x] Implement down-arrow click with smooth scroll to `messagesEl.scrollHeight`.
- [x] Hide the down-arrow when the user returns to bottom.
- [x] Ensure lazy preload and down-arrow behavior both use the same per-thread scroll state.

Done criteria:
- Older history starts loading before the user reaches the first visible loaded message.
- The visible message remains stable when lazy-loaded messages are prepended.
- Down-arrow appears only away from bottom and returns the user to latest messages.
- `npm run check` passes.
