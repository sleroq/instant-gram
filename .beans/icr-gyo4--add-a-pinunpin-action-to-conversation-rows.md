---
# icr-gyo4
title: Add a pin/unpin action to conversation rows
status: done
type: bug
priority: normal
tags:
    - browser
    - pins
    - accessibility
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-08-03T18:00:00Z
---

## Browser finding (2026-08-03)

The inbox displays persisted pin indicators, but users cannot pin or unpin. The complete typed `togglePin` RPC is already implemented through background persistence, while the Teact store exposes no action and `ChatRow` only renders the indicator.

## Scope

Expose a compact, accessible pin/unpin control (or accessible context action) from a conversation row. Keep pin order normalized in `store.ts`, call the existing RPC at the store boundary, update state only from the returned pin list, and provide a failure state without disrupting selection.

## Completed

- Added distinct current Instagram Web pin/unpin persisted mutations with strict
  `{ id, is_pin }` receipt parsing and exact `thread_fbid` ownership.
- Routed the narrow capability through the authenticated anchor and serialized
  persisted ordering in the background.
- Added optimistic store reconciliation, per-thread single-flight, rollback,
  stale-generation guards, and accessible pending/error row state.
- Replaced the placeholder Open conversation action with Pin conversation /
  Unpin conversation for selected and unselected rows across pointer, keyboard,
  and touch context interactions.
- Added catalog, parser, handler, store, and production browser regressions and
  documented the 2026-08-03 private-protocol source and doc-ID drift caveat.
