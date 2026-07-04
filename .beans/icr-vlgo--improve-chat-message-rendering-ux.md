---
# icr-vlgo
title: Improve chat message rendering UX
status: done
type: task
priority: normal
tags:
    - ux
    - chat
    - reels
    - replies
created_at: 2026-07-04T16:59:26Z
updated_at: 2026-07-04T17:50:39Z
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
- [x] Message bubbles no longer repeat the date inline.
- [x] Chat history displays clear date separators when the day or other major date boundary changes.
- [x] Users can still access an individual message's exact date/time from a secondary UI surface.
- [x] First message in each non-me sender group displays that sender's author name.
- [x] Sender grouping handles multi-user chats correctly, including transitions between different non-me authors.
- [x] Existing message rendering remains visually stable for one-on-one chats.



## Additional shared reel requirement
- In chat history, shared reels should render the reel preview banner instead of a large author profile image.

## Additional acceptance criterion
- [x] Shared reel messages display the reel preview/banner image in history rather than emphasizing the reel author's avatar.



## Reply rendering requirement
- Add proper rendering support for reply messages in chat history. Replies are currently unsupported and should show enough context to understand what message is being replied to.
- The reply preview should be visually distinct from the main message content and should handle missing/deleted/unavailable original messages gracefully.

## Additional reply acceptance criteria
- [x] Reply messages render with a clear quoted/preview area for the original message.
- [x] Reply rendering supports common original message types, including text and shared media/reels where available.
- [x] Replies remain readable inside grouped message layouts and multi-user chats.
- [x] Missing, deleted, or unavailable original messages show a sensible placeholder instead of breaking message rendering.
