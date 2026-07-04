---
# icr-vlgo
title: Improve chat message rendering UX
status: todo
type: task
priority: normal
tags:
    - ux
    - chat
created_at: 2026-07-04T16:59:26Z
updated_at: 2026-07-04T16:59:26Z
---

Consolidate related message rendering UX improvements into one task.

## Goal
Improve chat history readability by reducing repeated metadata while preserving access to exact message details.

## Requirements
- Remove the date from individual message rows/bubbles.
- Render major date changes as separators in the chat history instead.
- Keep the exact date/time for each message available elsewhere, e.g. in the message right-click/context menu, tooltip, details popover, or another low-noise interaction.
- For grouped consecutive messages, show the author name on the first message in the group when the sender is not me.
- Ensure this works for multi-user chats where several non-me participants may appear.

## Acceptance criteria
- [ ] Message bubbles no longer repeat the date inline.
- [ ] Chat history displays clear date separators when the day or other major date boundary changes.
- [ ] Users can still access an individual message's exact date/time from a secondary UI surface.
- [ ] First message in each non-me sender group displays that sender's author name.
- [ ] Sender grouping handles multi-user chats correctly, including transitions between different non-me authors.
- [ ] Existing message rendering remains visually stable for one-on-one chats.
