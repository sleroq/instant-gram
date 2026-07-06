---
# icr-h7rl
title: Add infinite scroll with preloading to chat sidebar
status: todo
type: feature
tags:
    - frontend
    - sidebar
created_at: 2026-07-04T17:34:37Z
updated_at: 2026-07-04T17:34:37Z
---

Implement infinite scrolling for the chat list in the sidebar, with preloading so upcoming chats are fetched before the user reaches the end.

Checklist:

- [ ] Locate the sidebar chat list component and its data-loading path.
- [ ] Add paginated/incremental loading support if the current chat query is not already paginated.
- [ ] Trigger preloading before the visible list reaches the end, using the existing scrolling or intersection-observer pattern if present.
- [ ] Preserve loading, empty, and error states for the chat list.
- [ ] Verify the sidebar loads additional chats smoothly without duplicate requests or duplicated chat rows.
