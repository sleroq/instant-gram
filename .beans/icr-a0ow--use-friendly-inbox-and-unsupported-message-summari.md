---
# icr-a0ow
title: Use friendly inbox and unsupported-message summaries
status: todo
type: bug
priority: high
tags:
    - browser
    - inbox
    - parsing
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-08-03T13:17:25Z
---

## Browser finding (2026-08-03)

Inbox previews expose protocol identifiers such as `Unsupported message (MESSAGE_INLINE_SHARE)` and `REMOVE_PARTICIPANT_XMAT`. `parseMessage()` can recognize one inline-share shape in history, while the inbox parser can receive a different shape; unsupported UI and `messageSummary()` also deliberately print raw `contentType` values.

## Scope

- Normalize known inline-share variants into the existing share presentation where enough metadata exists.
- Map known activity/protocol types to concise user-facing summaries (for example, “Shared a post” or “Removed a participant”).
- Fall back to “Unsupported message” without exposing raw protocol identifiers in normal UI.
- Preserve a developer-visible diagnostic path if raw content type is needed for investigation.
- Cover parser/summary mapping with focused tests.
