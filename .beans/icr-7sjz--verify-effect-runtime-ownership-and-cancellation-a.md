---
# icr-7sjz
title: Verify Effect runtime ownership and cancellation at worker boundaries
status: completed
type: task
priority: high
tags:
    - discovered
    - architecture
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T22:14:25Z
parent: icr-siiy
---

Current uncommitted Effect migration: lib/worker/runtime.ts uses Effect.runPromiseWith(context) for read command roots instead of the ManagedRuntime runner; interest removal invalidates generations without interrupting running detail requests. Keep browser Promise adapters but bind execution to worker runtime and manage shared-flight cancellation only when last eligible interest leaves. Add production-layer tests for runtime disposal with active read, release of network permits on last-interest removal, cold-start provider disconnect, and interruption during IndexedDB commit. Interrupted-commit and provider-startup races are risks requiring reproduction, not established failures. Preserve stale-result guards and transaction/revision durability.

Implemented and verified against pinned Effect 4.0.0-beta.107. Host roots use ManagedRuntime; engine producers use a scoped FiberSet and explicit fiber joins, with last-interest/account cancellation and identity tokens. Only started commit/install is protected; hydration/network/lane acquisition remain interruptible. Provider layer closes pending/readiness operations and Port listeners; startup disconnect and failed provisioning clean up synchronously. Standalone test factories expose disposal. Added short worker/engine/provider AGENTS.md rules. 129 tests pass, including 11 lifecycle regressions; lint/check/build/diff check pass. Shared scan exits 0 with 69 warnings versus 67 baseline: two new unknown-input warnings are at the browser structured-clone adapter forwarding into provider schema validation, not unparsed application data. No suppression or live-account claim. Chrome worker termination may skip finalizers; IDB commits/epochs remain durability authority.

Reopened after 2026-09-30 assessment found uncovered lifecycle paths. Controlled production-layer reproduction: hold readResources(history:a) in Effect.never, unsubscribe the last a interest, then subscribe b and Refresh. After 20 scheduler checkpoints the obsolete hydration is not interrupted, b hydration has not started, and Refresh has not completed; runtime disposal does interrupt it. subscribe() forks hydration outside tracked history flights (inbox.ts:1609), while release only detaches flights (:1644); obsolete hydration retains the serialized lane. Own/cancel eligible subscription hydration on last interest without interrupting a started protected commit or shared interested work. Also reproduced anchor-retry poisoning: ensureAnchor never settles; initial account and an explicit retry both time out, but anchor acquisitions stays 1. provider/inbox.ts:312-326 clears anchorFlight only on Promise settlement, so retries reuse a permanently hung acquisition. Make timeout/cancellation retirement and retry ownership explicit while preserving concurrent sharing. These are controlled regressions, not live hangs. Add focused release-during-hydration and timeout-then-retry tests. Live worker termination during a throttled history read DID stop/restart, change worker epoch, recover 19 cached rows and produce zero alerts; ManagedRuntime ownership fix remains valid.

## Fix-pass outcome — 2026-09-30

Completed reopened paths: shared hydration is tracked/cancelled without abandoning protected commits; last anchor-waiter timeout retires unresolved acquisition, and replacement flight ownership is safe. Existing complete tabs recover after extension reload using host-scoped scripting without navigation. Live provider Ports skip reinjection because WXT invalidates old contexts before main. Installed production: one detail request under 1,500ms latency across two windows; closing one leaves 80 rows/zero alerts. Actual stopped worker changes epoch and restores route/data. Final suite: 173 passed.
