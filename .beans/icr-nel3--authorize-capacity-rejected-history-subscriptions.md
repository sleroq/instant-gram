---
# icr-nel3
title: Authorize capacity-rejected history subscriptions before publishing facts
status: todo
type: bug
priority: critical
tags:
    - discovered
    - privacy
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T00:57:38Z
parent: icr-siiy
---

Static review found lib/engine/inbox.ts subscribe capacity branch (1406-1426) calls projectFor before subscription authorization, unlike the normal checkingProjection path. Retained account facts can be published while fresh identity verification is pending when detail interests are at capacity. Route capacity errors through the same identity gate. Acceptance: retain account A, disconnect clients, defer current identity, fill detail interests and add one extra; extra subscriber receives no A facts before authorization, including when provider later identifies B. Cover authorization failure and capacity recovery.
