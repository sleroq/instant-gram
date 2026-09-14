---
# icr-siiy
title: 'R1: Restore cached conversations and history'
status: in-progress
type: milestone
priority: critical
tags:
    - first-priority
    - solid-restoration
    - history
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-09-13T12:08:11Z
blocking:
    - icr-9ib2
---

Implement R1.1–R1.22 from `docs/solid-restoration-checklist.md`. This is the next production implementation milestone.

Deliver resource-scoped/reference-aware IndexedDB persistence before adding a second resource; coherent multi-resource snapshots and shared worker flights; inbox pagination; cached selection and responsive routes; resizable desktop layout and basic dark presentation; normalized bounded history with local-first ranges, logical restoration, stable prepend, and controlled fill; core message/share/reply/unavailable projection.

Do not expose mutations yet or restore retired frontend architecture. Preserve account identity, opaque worker-owned cursors, fixed 72 px inbox rows (max 31), history max 80, explicit retry, and cached content during refresh.

Exit: retained conversation opens without waiting for Instagram, inbox refresh cannot erase history, compact Back restores position/focus, and all R1 focused acceptance plus repository quality gates pass.

## Implementation decisions — 2026-09-13

- Baseline is `032e781`, all 71 tests and quality gates passing; raw/gzip sizes are
  recorded in `docs/r1-verification.md` before implementation.
- Fix v1 account-wide replacement before introducing page/history resources.
  References must retain current transitive thread dependencies, not old copies.
- Keep full snapshots scoped to inbox, selected detail, and a small warm working
  set; no delta framework, Effect runtime, Teact adapter, or UI-owned entity cache.
- Retention is distinct from contiguous coverage: refresh relinks only exact
  request/response cursor chains. Detached data remains retained until eviction.
- Serialize snapshot/commit acceptance and protect shared facts from overlapping
  older reads; weaker older-page viewer evidence cannot replace initial viewer.
- Restore read-only navigation and message projections now; commands remain R2.
- The bounded read-only slice is implemented. Final verification passes all 106
  tests, lint, typecheck, build, diff check, and the shared scan with no diagnostics.
  `docs/r1-verification.md` records evidence and limits; unchecked checklist
  acceptance must not be inferred from code presence alone.

The current implementation still stops durable history at 400 messages/20
segments. `icr-itlg` replaces that ceiling without introducing moving ranges:
retain complete loaded history for active and recent conversations, then evict
whole least-recently-used inactive histories under account-level storage pressure.
Keep this milestone in progress until that policy is implemented and verified; a
disabled continuation at the current cap is an honest transitional limit, not
feature parity.

## Implemented slice

Resource-specific v2 persistence, normalized shared facts, exact read descriptors,
inbox continuation, cached detail hydration, scoped flights, resource retry state,
URL selection/compact Back, window-local resizing/dark shell, bounded history
windows and anchors, and read-only message/share/reply/unavailable projections.

Discovered defects `icr-iebs`, `icr-vlv6`, and `icr-bst8` are fixed and verified.
R0 live/installed-extension checks and navigation p95 measurements remain open;
no send/read/pin/polling or media-player capability was introduced.
