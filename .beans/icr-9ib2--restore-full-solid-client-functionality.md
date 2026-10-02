---
# icr-9ib2
title: Restore full Solid client functionality
status: in-progress
type: epic
priority: critical
tags:
    - first-priority
    - solid-restoration
created_at: 2026-09-13T12:03:24Z
updated_at: 2026-09-13T12:04:58Z
---

Restore the retired Instagram client behavior on the sole Solid 2 UI and worker-owned local-first engine. This is the first-priority product program and the parent for delivery milestones R0–R5.

Source of truth: `docs/application-architecture.md`. Delivery scope and exact checklist IDs: `docs/solid-restoration-checklist.md`. Current implemented boundary: `docs/engine-inbox-contract.md`.

Do not restore Teact, its UI-owned store, direct component RPC, or parallel cache/mutation authority. Features ship only through account-partitioned IndexedDB resources, worker-owned synchronization/outbox contracts, and bounded Solid projections.

Program exit:

- R0 release evidence is recorded;
- R1 cached conversations/history and responsive layout ship;
- R2 durable core messaging ships;
- R3 full message interactions ship;
- R4 media/player/comments/engagement ship;
- R5 selected cross-cutting backlog and preferences ship or receive explicit product decisions;
- every slice passes the repository quality gate and updates current architecture documentation.

## Delivery beans (2026-09-13)

- `icr-siiy` — R1, completed with user-confirmed manual acceptance.
- `icr-xgh3` — R0 evidence, completed with user-confirmed manual acceptance.
- `icr-uizd` — R2, next unblocked implementation milestone (not started).
- `icr-jce7` — R3, blocked by R2.
- `icr-iwr9` — R4, blocked by R2 and may proceed alongside R3.
- `icr-kj7d` — R5, blocked until prerequisite restoration surfaces exist.

R6 remains optional product scope and is intentionally not a restoration milestone.
