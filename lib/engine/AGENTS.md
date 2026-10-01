# Engine lifecycle

Construct the engine in a scope. Shared producer fibers belong to its scoped
`FiberSet`, not command waiters. Last history interest invalidates generations,
detaches flights synchronously, and interrupts producers outside the commit lane.
Keep account/epoch/generation guards authoritative. Hydration and lane acquisition
stay interruptible; protect only persistence plus revision/entity publication.
