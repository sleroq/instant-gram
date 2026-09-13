---
# icr-siiy
title: 'R1: Restore cached conversations and history'
status: todo
type: milestone
priority: critical
tags:
    - first-priority
    - solid-restoration
    - history
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-09-13T12:04:07Z
blocking:
    - icr-9ib2
---

Implement R1.1–R1.22 from `docs/solid-restoration-checklist.md`. This is the next production implementation milestone.

Deliver resource-scoped/reference-aware IndexedDB persistence before adding a second resource; coherent multi-resource snapshots and shared worker flights; inbox pagination; cached selection and responsive routes; resizable desktop layout and basic dark presentation; normalized bounded history with local-first ranges, logical restoration, stable prepend, and controlled fill; core message/share/reply/unavailable projection.

Do not expose mutations yet or restore retired frontend architecture. Preserve account identity, opaque worker-owned cursors, fixed 72 px inbox rows (max 31), history max 80, explicit retry, and cached content during refresh.

Exit: retained conversation opens without waiting for Instagram, inbox refresh cannot erase history, compact Back restores position/focus, and all R1 focused acceptance plus repository quality gates pass.
