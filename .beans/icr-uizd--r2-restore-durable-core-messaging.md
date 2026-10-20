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
updated_at: 2026-10-20T19:47:14Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-siiy
---

Durable core send/reply, pin/read commands and worker-owned visible-interest polling are implemented and complete with user-confirmed acceptance. Unknown sends are not blindly retried, and persisted dedup evidence has no expiry policy; acceptance does not claim additional agent-run live verification.
