---
# icr-uizd
title: 'R2: Restore durable core messaging'
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - dm
    - mutations
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-10-01T20:25:52Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-siiy
---

Implement R2.1–R2.12 from `docs/solid-restoration-checklist.md` after R1.

Deliver durable per-account command acceptance/deduplication, canonical facts plus ordered overlays, per-target serialization, send/reply, pin/unpin, paired read marking, Solid composer/pending/failure behavior, and worker-owned interest polling fallback. Normal inbox and selected-thread freshness must become automatic for visible interested clients; Refresh must cease to be the routine synchronization UX and remain only as a repair/retry affordance. Cut over each mutation family atomically; no UI mutation authority or independent polling.

Exit: accepted operations survive worker restart, two clients converge without duplicate provider dispatch, quota failure dispatches nothing, stale reads cannot erase intent, and all R2 acceptance plus quality gates pass.

R0 and R1 are completed following user-confirmed manual acceptance. This is now the next unblocked implementation milestone; it remains todo until feature work begins.
