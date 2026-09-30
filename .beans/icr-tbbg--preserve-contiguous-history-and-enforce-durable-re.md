---
# icr-tbbg
title: Preserve contiguous history and enforce durable retention after restart
status: todo
type: bug
priority: high
tags:
    - discovered
    - history
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T00:57:38Z
parent: icr-siiy
---

Static review found lib/engine/inbox.ts 1223-1265 truncates chronological page IDs with slice(0, available), retaining the wrong edge and storing the full-page cursor despite omitted adjacent messages. Root counting uses only hydrated historySegments although repository commits merge all durable resources; restart can exceed the current 20-root cap. Coordinate with icr-itlg rather than cementing the transitional 400-row cap. Acceptance: oversized head/continuation never claim coverage across discarded messages; account retention uses durable inventory after restart and protects interested/recent histories; provider exhaustion stays distinct from storage pressure.
