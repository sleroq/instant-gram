---
# icr-7h98
title: Retry reads automatically before exposing recovery controls
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:41:26Z
parent: icr-i2ye
blocked_by:
    - icr-4rev
---

The user resolved the recovery decision: retry safe failures automatically first, then show manual recovery controls if automatic recovery cannot complete. Remove routine Refresh/Refresh history controls. Remove Show latest messages as a separate coverage-switch action; icr-j8fk owns its automatic-tail replacement and icr-mwu8 owns intentional down/newest navigation.

- [ ] Reuse the worker's existing visible-interest head polling/backoff. Add a bounded automatic recovery policy for eligible transient data-read/continuation failures at that owner, with explicit attempt/time limits and supplied retry-after. Do not stack another UI timer or duplicate polling flight.
- [ ] Distinguish query reads from read-receipt mutations. Preserve exact failed-cursor ownership, generations, cached content, cyclic/no-progress terminal gates and account isolation. Non-retryable protocol/auth/invalid-request failures need honest actionable handling, not a blind retry loop.
- [ ] During automatic recovery use the state orb (icr-4rev) and honest status; after the retry budget is exhausted expose appropriate failure-specific Retry/reconnect controls. Hard failures may surface an actionable state immediately when another automated attempt cannot help.
- [ ] Remove the normal always-visible Refresh buttons and update the documented UI recovery contract when implementation ships. Do not remove worker refresh/read capabilities used for recovery.
- [ ] Do not automatically replay uncertain sends or other mutations. R2's unknown-outcome/idempotency restrictions remain mandatory; automatic data-read retry is not permission to resend messages.
- [ ] Cover transient success after retry, exhaustion/manual Retry, rate limiting, permanent/no-progress failure, exact continuation retry, hidden/visible interests and teardown.

Decision confirmed; this is no longer a draft. Automatic latest adoption is a separate dependent-compatible feature, not a cosmetic deletion of coverage evidence.
