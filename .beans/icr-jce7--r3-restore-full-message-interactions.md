---
# icr-jce7
title: 'R3: Restore full message interactions'
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - dm
    - interactions
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-09-13T12:04:21Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-uizd
---

Implement R3.1–R3.20 from `docs/solid-restoration-checklist.md` after durable core messaging.

Restore reactions including removal, full picker, timed editing and bounded receipt reconciliation; staged forwarding; local-first reply navigation/return/prefetch; context menus and long-press; physical keyboard navigation, clipboard behavior, and global actionable feedback. Rebuild behavior against worker-owned facts/outbox and bounded Solid views rather than porting retired stores/components.

Exit: receipt races, partial forwarding retry, reply jumps, focus restoration, keyboard exclusions, and fetch bounds pass focused tests and the repository quality gate.
