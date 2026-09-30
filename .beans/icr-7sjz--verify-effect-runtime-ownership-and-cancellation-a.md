---
# icr-7sjz
title: Verify Effect runtime ownership and cancellation at worker boundaries
status: todo
type: task
priority: high
tags:
    - discovered
    - architecture
created_at: 2026-09-30T00:57:38Z
updated_at: 2026-09-30T00:57:38Z
parent: icr-siiy
---

Current uncommitted Effect migration: lib/worker/runtime.ts uses Effect.runPromiseWith(context) for read command roots instead of the ManagedRuntime runner; interest removal invalidates generations without interrupting running detail requests. Keep browser Promise adapters but bind execution to worker runtime and manage shared-flight cancellation only when last eligible interest leaves. Add production-layer tests for runtime disposal with active read, release of network permits on last-interest removal, cold-start provider disconnect, and interruption during IndexedDB commit. Interrupted-commit and provider-startup races are risks requiring reproduction, not established failures. Preserve stale-result guards and transaction/revision durability.
