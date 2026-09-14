---
# icr-iebs
title: Scope synthetic message identity to its conversation
status: completed
type: bug
priority: high
tags:
    - discovered
    - solid-restoration
created_at: 2026-09-13T12:32:48Z
updated_at: 2026-09-13T13:15:20Z
parent: icr-siiy
---

R1 normalization exposes a reproducible collision: parseMessage({content_type:"TEXT",sender_id:"same",timestamp_ms:1,text_body:"thread A"}) and another thread B row both return synthetic id same:1:TEXT; a shared normalized dictionary keeps only one. Scope synthetic cache identity to stable conversation identity at the engine normalization boundary, consistently for inbox last-message and history rows; leave real provider IDs unchanged and keep isSyntheticId. Regression: two conversations retain distinct missing-ID rows and inbox/history of the same thread share one synthetic fact. No component protocol logic or mutation ID invention.

## Resolution

`scopeSyntheticMessage` applies a length-delimited conversation scope at engine
normalization, shared by inbox previews and history. Real IDs and `isSyntheticId`
remain unchanged; normalization is idempotent. Focused engine tests verify
cross-thread separation and repeated normalization, and the read-order journal
preserves the complete colon-containing cache key when pruning.
