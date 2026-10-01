---
# icr-tbbg
title: Preserve contiguous history and enforce durable retention after restart
status: completed
type: bug
priority: high
tags:
    - discovered
    - history
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T22:14:25Z
parent: icr-siiy
---

Static review found lib/engine/inbox.ts 1223-1265 truncates chronological page IDs with slice(0, available), retaining the wrong edge and storing the full-page cursor despite omitted adjacent messages. Root counting uses only hydrated historySegments although repository commits merge all durable resources; restart can exceed the current 20-root cap. Coordinate with icr-itlg rather than cementing the transitional 400-row cap. Acceptance: oversized head/continuation never claim coverage across discarded messages; account retention uses durable inventory after restart and protects interested/recent histories; provider exhaustion stays distinct from storage pressure.

## Fix-pass outcome — 2026-09-30

Completed: v4 retains complete oversized pages/chunks, bounded indexed reads, exact coverage, incremental references and durable inventory/whole-root eviction. Unmatched head retains one proven previous generation and frontier; old readers use explicit latest navigation. Regressions exceed 1,200 messages and verify restart/independent windows/bounded cleanup. Actual live history had 160 messages; live >400/pressure acceptance stays open under R0/R1/icr-itlg.
