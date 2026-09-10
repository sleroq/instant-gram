---
# icr-gi4a
title: Refresh and mutation UX hardening
status: scrapped
type: milestone
priority: normal
tags:
    - dm
    - ux
created_at: 2026-07-04T16:58:23Z
updated_at: 2026-08-03T13:35:41Z
---

Harden refresh, de-duplication, and failure UX after future text/reply/reaction mutations in the current normalized Teact store.

## Scope

- Refresh the active thread after successful mutations and de-duplicate server messages against local pending metadata.
- Preserve older-reading position; move to bottom only for active-bottom send flows.
- Update inbox snippets after successful sends or active-thread refreshes.
- Centralize pending/failed mutation state so bubbles, composer, and thread entities agree.
- Document manual QA for send, reply, reaction, refresh, and authentication recovery.

Do not add MQTT/live-websocket support; active-thread refresh is the intended first path.

## Disposition

Merged into `icr-9qjx`. Reconciliation, de-duplication, failure recovery, inbox metadata, and scroll behavior are definition-of-done requirements rather than a deferred hardening milestone.
