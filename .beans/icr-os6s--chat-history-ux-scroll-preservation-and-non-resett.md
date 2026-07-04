---
# icr-os6s
title: 'Chat history UX: scroll preservation and non-resetting renders'
status: completed
type: milestone
priority: high
tags:
    - chat-history
    - scroll
created_at: 2026-07-04T16:31:58Z
updated_at: 2026-07-04T16:43:04Z
blocked_by:
    - icr-zmst
---

Large milestone for making scroll position durable and preventing unexpected jumps while switching chats or loading older history.

Context:
- Current `entrypoints/ui/App.svelte` conditionally mounts the message list only for ready state.
- Loading older messages replaces the whole message view with a loading state, which resets the DOM and scroll position.
- The most important product requirement is to avoid resetting scroll position unexpectedly.

Checklist:
- [x] Keep the message scroll container mounted while a thread is selected.
- [x] Bind the message scroll element and track `scrollTop`, `scrollHeight`, `clientHeight`, and `isAtBottom` per thread.
- [x] Save the current thread scroll state before switching to another thread.
- [x] Restore exact `scrollTop` when returning to a cached thread that was not at bottom.
- [x] Scroll to bottom only on first load of a never-opened thread, or when the cached thread was previously at bottom.
- [x] Refactor older-message loading so it never replaces visible messages with a loading screen.
- [x] When prepending older messages, preserve the visible anchor by adjusting `scrollTop` after DOM update.
- [x] Use Svelte `tick()` for post-render scroll restoration.

Done criteria:
- Loading older messages does not move the currently visible message.
- Switching between chats restores each chat to its previous scroll position.
- No pagination path unmounts the message scroll container.
- `npm run check` passes.
