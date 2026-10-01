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
updated_at: 2026-09-30T22:14:25Z
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

2026-09-30: partial live installed DEVELOPMENT-extension evidence is now available via the dev browser/CDP; earlier browser-unavailable statements remain historical. See docs/r1-verification.md for toolbar launch, no/one/multiple Instagram tabs, cached reload, two-client sharing, failure/retry and actual stopped/restarted worker with changed workerEpoch. Account switching/logout, unknown-identity offline cold reopening, p95 navigation, and installing/testing the production build remain unverified. Do not close R0 or relabel dev evidence as production release evidence.

## Fix-pass outcome — 2026-09-30

Production build installed unpacked with authenticated profile intact and no private artifacts. Chrome Developer mode was required; disabled unpacked/CDP failures were environmental, and final toolbar/reload/worker-stop flows were rerun successfully. 173 tests and quality gates pass; shared scan has 102 warnings. Warm p95 8.4ms/12 samples and authorized retained-cold p95 80.4ms/5 real worker stops meet provisional 100/300ms targets; methods/overhead are recorded. Still unverified: account switch/logout, unknown-identity offline cold open, missing-history p95, real delayed images, server unread-state regression and live >400/pressure. This does not establish packaged/Web Store acceptance.
