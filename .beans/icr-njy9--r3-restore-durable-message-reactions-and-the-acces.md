---
# icr-njy9
title: 'R3: Restore durable message reactions and the accessible picker'
status: todo
type: feature
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:48:02Z
parent: icr-jce7
blocked_by:
    - icr-i2ye
---

Deliver durable message reactions as the functional prerequisite for reaction/like animations. This is a child implementation slice of icr-jce7, not duplicate scheduling authority.

- [ ] Add/change/remove the viewer's message reaction through closed provider methods and the worker durable outbox, with target/receipt validation and safe stale-read/optimistic reconciliation.
- [ ] Provide the six quick choices plus categorized searchable keyboard-accessible picker, with Unicode/VS16 normalization at the domain boundary.
- [ ] Compose with existing contextual Reply placement icr-83kg and context menus icr-u9ok, preserving stable message keys, pointer/touch/keyboard access and mount bounds.
- [ ] Cover same-reaction removal, receipt/error/stale-read races, focused controls and account isolation before adding cosmetic reaction feedback.

This means message reactions/heart, not R4 post likes or player engagement. No animation may act as substitute for actual durable reaction success/state.
