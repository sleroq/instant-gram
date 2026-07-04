---
# icr-5uvl
title: 'Chat history UX: manual QA and performance verification'
status: todo
type: milestone
priority: normal
tags:
    - chat-history
    - qa
created_at: 2026-07-04T16:32:14Z
updated_at: 2026-07-04T16:32:14Z
blocked_by:
    - icr-os6s
    - icr-7ycg
---

Large milestone for validating the completed chat-history refactor against the user-facing UX requirements.

Context:
- The core requirement is not just functional pagination; it is that scroll position never resets unexpectedly.
- Automated type checks are necessary but not sufficient for scroll behavior.

Checklist:
- [x] Run `npm run check` and fix any type/Svelte errors introduced by the refactor.
- [x] Manually verify switching between at least two chats preserves each chat scroll position.
- [x] Manually verify returning to a cached chat does not refetch its initial message page.
- [ ] Manually verify older-history preload starts before reaching the top.
- [x] Manually verify prepending older messages keeps the same visible message anchored.
- [x] Manually verify initial open of a thread scrolls to bottom once.
- [ ] Manually verify the down-arrow appears away from bottom, scrolls to bottom, and then hides.
- [x] Inspect the implementation to confirm loading older messages never replaces the whole message list with a loading screen.

Done criteria:
- All manual checks pass in the extension UI.
- `npm run check` passes.
- Any residual UX limitations are documented in this bean before closing.
