---
# icr-siiy
title: 'R1: Restore cached conversations and history'
status: completed
type: milestone
priority: critical
tags:
    - first-priority
    - solid-restoration
    - history
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-10-01T20:25:52Z
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
  set; no delta framework, Teact adapter, or UI-owned entity cache.
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

## Implemented slice (current)

Resource-specific v4 persistence, complete page retention, bounded indexed windows,
one previous proven coverage, normalized facts, exact read descriptors, inbox
continuation, identity-gated subscriptions, scoped flights/hydration, explicit
retry/latest navigation, responsive routes/anchors and read-only projections.

Discovered defects `icr-iebs`, `icr-vlv6`, and `icr-bst8` are fixed and verified.
R0 live/installed-extension checks and navigation p95 measurements remain open;
no send/read/pin/polling or media-player capability was introduced.

Historical assessment before the fix pass — 2026-09-30: one pinned Effect ManagedRuntime with scoped producers is now the implemented worker workflow authority (supersedes the earlier no-Effect implementation decision). Current automated suite has 129 passing tests; lint/check/build/diff check pass; shared scan has 69 warnings. Live dev-extension startup, cached reads, two-window sharing, cancelled stale-result rejection, network failure/retry, and actual worker termination/restart have evidence in docs/r1-verification.md. This is not production-installed release or p95 evidence. R1 remains in progress: critical authorization icr-nel3 is now reproduced in a controlled fixture; navigation/sidebar/malformed-route icr-w08c is live-confirmed; retention icr-tbbg/icr-itlg remains open; icr-7sjz is reopened for abandoned subscription hydration blocking the commit lane and timed-out anchor retry poisoning; new icr-45nb tracks Solid dev diagnostic misuse. R2 remains blocked by R1.

## Fix-pass outcome — 2026-09-30

Fixed icr-nel3, icr-w08c, icr-tbbg, icr-7sjz and icr-45nb. Final suite: 173 passed; lint/check/build/diff check pass; shared scan exits 0 with 102 warnings. Installed production verifies toolbar/reload recovery, visual bounds, exact Back/focus, offline Retry, shared-read cancellation and actual worker restart. Provisional warm p95 8.4ms/12 samples and authorized retained-cold p95 80.4ms/5 samples. Durable >1,200/changed-head/restart/eviction is fixture-tested; live history has 160 messages. R1 stays open for remaining acceptance in docs/r1-verification.md; R2 remains blocked.

## User acceptance

The user confirms that this read-only stage is working and manual testing passed, and explicitly requests completion before continuing to new features. Closed on that acceptance together with the recorded 173-test and installed-production evidence. Earlier agent-only evidence gaps remain historical limitations, not pending stage blockers; no additional per-scenario measurements are claimed.
