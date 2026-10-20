# Worker host

Compose one provider, repository, and engine in the production `ManagedRuntime`.
Use the exactly pinned Effect version; upgrades require deliberate migration.
Keep entrypoints orchestration-only: domain work belongs to its owning module.

All host roots enter through that runtime: Promise commands use `runPromise`,
callbacks use `runFork`. Disposal interrupts roots and scoped engine work.
Observe unexpected defects without logging expected failures or interruption.
Never bypass ownership with context-only runners. Promise/callback adaptation
belongs at host boundaries, not in engine workflows.

See [application ownership](../../docs/application-architecture.md),
[engine rules](../engine/AGENTS.md), and [provider rules](../provider/AGENTS.md).
