---
# icr-xgh3
title: 'R0: Record Solid release evidence'
status: in-progress
type: milestone
priority: high
tags:
    - solid-restoration
    - evidence
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-09-13T12:13:35Z
blocking:
    - icr-9ib2
---

Record the installed-extension and performance baseline in R0.5–R0.7 of `docs/solid-restoration-checklist.md`: browser-action launch, provider selection, account switch, worker restart, and clearly separated missing/warm/authorized retained-cold measurements. Live-account unavailability is an explicit evidence gate, not permission to claim verification.

Exit: evidence names fixture/build/browser/hardware/account state; provisional budgets are reported as targets versus results; architecture docs remain accurate. Run the complete repository quality gate.

## Evidence recorded — 2026-09-13

- Baseline source `032e781`, platform, Node, exact raw/gzip entry sizes, and passing
  71-test/lint/type/build/shared-scan results are in `docs/r1-verification.md`.
- Desktop browser service is disconnected; no live Instagram account or installed
  extension evidence is available through it. R0.5 and live-account checks remain
  open. This records the R0.7 gate, not a live verification pass.
- R1 fixture browser measurements will be recorded separately from live evidence.
