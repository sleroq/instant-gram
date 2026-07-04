---
# icr-zmst
title: 'Chat history UX: message cache and stable state'
status: todo
type: milestone
priority: high
tags:
    - chat-history
    - ux
created_at: 2026-07-04T16:31:26Z
updated_at: 2026-07-04T16:31:26Z
---

Large milestone for eliminating repeated message fetches and replacing the single global message view with a per-thread cache.

Context:
- Current UI stores messages in one global `messages` state in `entrypoints/ui/App.svelte`.
- `selectThread()` always sets loading and refetches the first page.
- `loadOlder()` also replaces the rendered message view with loading state.

Checklist:
- [ ] Introduce a per-thread cache keyed by stable thread key.
- [ ] Store per-thread `ThreadMessages`, cursor, `hasNextPage`, initial-loading state, older-loading state, and error state.
- [ ] Refactor `selectThread()` to render cached messages immediately when available.
- [ ] Fetch the first message page only for uncached threads.
- [ ] Ignore stale request responses when the selected thread changed before the request completed.
- [ ] Deduplicate messages by `message.id` when merging pages.
- [ ] Keep current RPC contracts unchanged unless implementation proves a backend cache is necessary.

Done criteria:
- Switching away from and back to an already-opened chat does not call `getThread` again for the initial page.
- Cached chats render immediately without a full loading-screen transition.
- `npm run check` passes.
