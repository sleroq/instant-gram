---
# icr-nel3
title: Authorize capacity-rejected history subscriptions before publishing facts
status: completed
type: bug
priority: critical
tags:
    - discovered
    - privacy
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T22:16:31Z
parent: icr-siiy
---

Static review found lib/engine/inbox.ts subscribe capacity branch (1406-1426) calls projectFor before subscription authorization, unlike the normal checkingProjection path. Retained account facts can be published while fresh identity verification is pending when detail interests are at capacity. Route capacity errors through the same identity gate. Acceptance: retain account A, disconnect clients, defer current identity, fill detail interests and add one extra; extra subscriber receives no A facts before authorization, including when provider later identifies B. Cover authorization failure and capacity recovery.

Controlled production-layer reproduction on 2026-09-30: bootstrap account A with 21 fixture threads, defer renewed provider account verification, fill 20 distinct detail interests, then subscribe the 21st. The capacity-rejected projection exposes account A and all 21 retained thread facts while identity remains pending. This is now reproduced against current code, not just a static-review risk; no live cross-account session was modified.

## Fix-pass outcome — 2026-09-30

Completed: capacity-rejected and new independent subscribers remain fact-free until their own identity gate succeeds. Established authorized clients retain usable cache during soft renewal failures; trusted same-Port replacement receives slot/root credit. Production-layer regressions cover pending/failed identity, capacity recovery and account changes. Final suite: 173 passed; see docs/r1-verification.md#fixes-and-production-retest--2026-09-30.
