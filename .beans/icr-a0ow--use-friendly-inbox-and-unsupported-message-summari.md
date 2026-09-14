---
# icr-a0ow
title: Use friendly inbox and unsupported-message summaries
status: completed
type: bug
priority: high
tags:
    - parsing
    - solid-restoration
    - browser
    - inbox
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-09-13T13:24:17Z
parent: icr-siiy
---

## Browser finding (2026-08-03)

Inbox previews expose protocol identifiers such as `Unsupported message (MESSAGE_INLINE_SHARE)` and `REMOVE_PARTICIPANT_XMAT`. `parseMessage()` can recognize one inline-share shape in history, while the inbox parser can receive a different shape; unsupported UI and `messageSummary()` also deliberately print raw `contentType` values.

## Scope

- Normalize known inline-share variants into the existing share presentation where enough metadata exists.
- Map known activity/protocol types to concise user-facing summaries (for example, “Shared a post” or “Removed a participant”).
- Fall back to “Unsupported message” without exposing raw protocol identifiers in normal UI.
- Preserve a developer-visible diagnostic path if raw content type is needed for investigation.
- Cover parser/summary mapping with focused tests.



## Solid restoration handoff (2026-09-13)

The retired UI referenced above is no longer production. Deliver the parser semantics and Solid projection as R1.20 under `icr-siiy`; do not recreate a UI-owned store. Keep raw protocol identifiers outside ordinary user copy and preserve a redacted diagnostic path.
