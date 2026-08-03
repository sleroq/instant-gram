---
# icr-llfi
title: Record browser exploration baseline
status: completed
type: task
priority: normal
tags:
    - browser
    - qa
created_at: 2026-08-03T13:17:50Z
updated_at: 2026-08-03T13:17:50Z
---

## Browser exploration (2026-08-03)

Tested desktop and narrow/mobile layouts, opened conversations, scrolled history, inspected accessibility, and checked the browser console.

### Passed

- Conversations open at newest messages.
- Reel/post cards, reply previews, dates, images, and incoming/outgoing presentation render correctly.
- Narrow layout hides the inbox and exposes an accessible “Back to inbox” button.
- No horizontal overflow observed.
- No application console errors or warnings observed.
- The tested conversation retained a bounded 19 rendered message rows.

### Follow-up defects recorded separately

- `icr-2on6`: inbox dates fall back to epoch due to numeric-string thread activity timestamps.
- `icr-a0ow`: raw protocol identifiers appear in previews.
- `icr-gyo4`: UI cannot invoke the existing pin/unpin RPC.
- `icr-yvm4`: unavailable shares need an intentional visual state.

The extension-management “Errors” badge was explicitly excluded because it may show stale development errors.
