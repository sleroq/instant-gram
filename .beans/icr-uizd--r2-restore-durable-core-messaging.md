---
# icr-uizd
title: 'R2: Restore durable core messaging'
status: completed
type: milestone
priority: high
tags:
    - solid-restoration
    - dm
    - mutations
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-10-20T15:07:36Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-siiy
---

Implement R2.1–R2.12 from `docs/solid-restoration-checklist.md` after R1.

Deliver durable per-account command acceptance/deduplication, canonical facts plus ordered overlays, per-target serialization, send/reply, pin/unpin, paired read marking, Solid composer/pending/failure behavior, and worker-owned interest polling fallback. Normal inbox and selected-thread freshness must become automatic for visible interested clients; Refresh must cease to be the routine synchronization UX and remain only as a repair/retry affordance. Cut over each mutation family atomically; no UI mutation authority or independent polling.

Exit: accepted operations survive worker restart, two clients converge without duplicate provider dispatch, quota failure dispatches nothing, stale reads cannot erase intent, and all R2 acceptance plus quality gates pass.

R0, R1, and R2 are complete following user-confirmed manual acceptance. After the read acknowledgement and sidebar refresh fixes, the user confirmed everything seems good and asked to close testing-blocked work. R2.1–R2.12 and the R2 testing/acceptance gate are complete. See docs/r2-verification.md for evidence limits and the indefinite persisted dedup-tombstone storage tradeoff; these are not remaining R2 blockers.

## Historical verification progress

Local automated verification complete: 182 tests pass; lint, TypeScript, production build, diff check, and shared scan pass (three explained boundary-validator warnings). Combined gzip increase over reconstructed current R1 HEAD is 12.44 KiB. See docs/r2-verification.md for exact evidence and remaining live/account/release gates. No live Instagram mutations were performed; this milestone remains in-progress pending release acceptance.

Manual-QA follow-up icr-7tvo completed: corrected the live read actor FBID, stale/duplicate read errors, and history-induced sidebar reordering. Fresh suite: 188 tests across 24 files pass; details and evidence limits in docs/r2-verification.md. R2 release/user acceptance remains pending.

## Acceptance

The user confirmed the corrected build works and authorized completion of testing-blocked work. R2 is completed; R3 (icr-jce7) is the next milestone. This is user acceptance, not an additional agent-run live test, new performance measurement, commit, or published release.
