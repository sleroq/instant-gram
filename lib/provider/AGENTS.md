# Provider lifecycle

Own Ports with scoped acquisition and synchronous closed-state cleanup. Remove
listeners, fail local pending/readiness operations, and disconnect owned Ports.
Capture startup disconnect and clean up failed activation; install listeners before
waking readiness. Dispose standalone test factories. Verify pinned Effect APIs.

Recover complete existing Instagram tabs by injecting the compiled MAIN/ISOLATED
scripts only when this worker has no live provider Port for that tab. WXT creates
its content context before `main` and invalidates the prior context on reinjection;
an initializer-only singleton cannot protect pending RPCs. Loading/new tabs use
manifest injection. Keep scripts host-scoped and never reload user tabs.
