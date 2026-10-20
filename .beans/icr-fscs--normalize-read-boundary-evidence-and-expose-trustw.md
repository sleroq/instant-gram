---
# icr-fscs
title: Normalize read-boundary evidence and expose trustworthy unread counts
status: todo
type: feature
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:41:26Z
parent: icr-sphm
blocked_by:
    - icr-i2ye
---

Establish the data contract before replacing unread dots with numeric badges. Existing inbox parsing reads a viewer server receipt timestamp to derive isUnread but discards that evidence; local read-command watermarks alone are not a complete imported server boundary.

- [ ] Review sanitized captures/current parser semantics for server read boundaries or an authoritative per-thread unread-message count. Request/provider configuration values and folder unread-thread counts are not unread-message totals.
- [ ] Preserve proven server read-boundary identity/timestamp evidence at the provider/domain/storage boundary, with account and viewer identity checks. Define ties, counted incoming message kinds and explicit marked-as-unread semantics rather than equating that flag to one unread message.
- [ ] Expose worker-owned count metadata with exact/partial/unknown completeness. Derive exact counts only from authoritative totals or proven contiguous newest-to-boundary coverage; retained entities, detached pages and bounded windows cannot establish the total.
- [ ] Replace the inbox blue dot with an honest badge: real totals when proven and an explicit incomplete/loading state otherwise, never a fabricated zero/one. Integrate future icons-only rows and enrich the floating new-message badge without conflating server-unread with new-since-leaving-bottom.
- [ ] Cover unloaded pages, same-timestamp messages, partial/gapped coverage, account switches, peer reads, explicit marked unread and durable local read settlement. Do not fetch every unread history merely to render an unsupported exact count.

This is a protocol/model prerequisite, not a UI-only counter. No raw provider fields or a second count store in components.
