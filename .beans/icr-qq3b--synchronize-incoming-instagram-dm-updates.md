---
# icr-qq3b
title: Investigate passive Instagram live updates (R5)
status: todo
type: task
priority: normal
tags:
    - discovered
    - dm
    - realtime
    - solid-restoration
created_at: 2026-08-06T14:50:22Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-kj7d
---

Investigate passive Iris/MQTT/page-runtime updates using fresh authenticated capture and two-account validation. Existing accepted worker-owned visible-interest polling remains the synchronization authority; do not duplicate it or add UI-owned synchronization.

- [ ] Capture redacted event structure and reconnect/auth/tab lifecycle from Instagram's own client; existing HAR has no decoded WebSocket contract.
- [ ] Prove a narrow validated, credential-safe typed boundary into worker reconciliation. Never build a raw MQTT client or expose tokens, raw frames or message content in diagnostics.
- [ ] Validate duplicate/out-of-order updates, send echoes, reaction receipt races, stable IDs and pin ordering, stale generations and teardown.
- [ ] Preserve bounded history and older-reading anchors; follow only genuine newest intent. Verify incoming messages and reactions with two accounts before claiming live transport works.

This evidence-gated research is not a prerequisite for current recovery polish; typing/read-receipt expansion requires its own captured contract.
