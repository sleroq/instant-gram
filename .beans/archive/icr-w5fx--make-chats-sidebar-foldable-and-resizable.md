---
# icr-w5fx
title: Make chats sidebar foldable and resizable
status: scrapped
type: feature
priority: normal
tags:
    - ui
created_at: 2026-07-04T17:35:15Z
updated_at: 2026-08-03T00:00:00Z
---

Scrapped and superseded by the explicit product decision in
`docs/frontend-visual-refresh-plan.md`: the floating chats sidebar is
non-collapsible, non-resizable, uses the full available shell height, and has no
persisted geometry. The briefly implemented vertical-height resize path was
removed rather than retained as dormant code.

Checklist:

- [x] Record the superseding non-resizable product decision.
- [x] Remove resize UI, persistence, state, RPC, tests, and documentation.
