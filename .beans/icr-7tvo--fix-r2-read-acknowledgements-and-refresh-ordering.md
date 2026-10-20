---
# icr-7tvo
title: Fix R2 read acknowledgements and refresh ordering regressions
status: completed
type: bug
priority: high
tags:
    - discovered
created_at: 2026-10-20T14:02:19Z
updated_at: 2026-10-20T14:28:16Z
parent: icr-uizd
---

User manual QA: Instagram read state changes successfully, but the UI retains both invalid_request Retry read and failed unknown_outcome read controls. Refreshing sidebar temporarily reorders conversations, then returns to unchanged initial order. Reproduce at provider/engine/client boundaries, fix underlying state/ordering ownership, add regression coverage, and rerun all local quality gates. Browser MCP connection unavailable during initial investigation.

Fixed proven live identity mismatch: read participant matches PolarisViewer.data.fbid, not the old auth probe/account identity. Kept strict receipt validation; updated bridge can replace an installed legacy probe. Fresh canonical read confirmation retires failed read operations without replay, and UI supersedes duplicate local errors. History refresh preserves inbox-owned pin/activity/preview facts; seen read watermarks remain valid when inbox advances. Added actor/probe lifecycle, engine ordering/read, and browser error-cleanup regressions. Local verification: 188 tests pass; lint/typecheck/build/diff checks pass; shared scan retains only three explained existing boundary warnings. Live diagnostic retries were confined to the same already-read conversation; fixed-build end-to-end retest was blocked by CDP target/navigation discovery, and temporary verification windows/copies were cleaned up.
