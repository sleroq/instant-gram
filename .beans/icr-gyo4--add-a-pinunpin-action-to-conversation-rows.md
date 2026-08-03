---
# icr-gyo4
title: Add a pin/unpin action to conversation rows
status: todo
type: bug
priority: normal
tags:
    - browser
    - pins
    - accessibility
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-08-03T13:17:25Z
---

## Browser finding (2026-08-03)

The inbox displays persisted pin indicators, but users cannot pin or unpin. The complete typed `togglePin` RPC is already implemented through background persistence, while the Teact store exposes no action and `ChatRow` only renders the indicator.

## Scope

Expose a compact, accessible pin/unpin control (or accessible context action) from a conversation row. Keep pin order normalized in `store.ts`, call the existing RPC at the store boundary, update state only from the returned pin list, and provide a failure state without disrupting selection.
