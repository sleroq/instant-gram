---
# icr-iwr9
title: 'R4: Restore media, player, and engagement'
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - media
    - engagement
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-09-13T12:04:21Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-uizd
---

Implement R4.1–R4.23 from `docs/solid-restoration-checklist.md` once R1 persistence exists; engagement mutations also require the R2 outbox.

Restore normalized media metadata and retention, closed protocol reads, intent-ranked lazy loading, stable previews, safe avatars and unavailable/media-forward cards; accessible modal and custom player behavior; signed-URL repair; lazy bounded comments; durable like/save/comment engagement and outcome-unknown handling for non-idempotent comment creation.

Never persist media bytes/data URLs or put Instagram payloads in components. Exit requires geometry, cleanup, account/resource scope, optimistic settlement, player-state, comments budget, and repository quality checks.
