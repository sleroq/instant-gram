# Worker lifecycle

Use the single production `ManagedRuntime` for all host roots: Promise commands
use `runPromise`, callbacks use `runFork`. Observe unexpected defects without
logging expected failures or interruption. Never bypass ownership with context-only runners.
