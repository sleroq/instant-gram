# Inbox and conversation engine contract

**Status:** R1 read-only resource implementation. Read with the stable
[application contract](application-architecture.md),
[restoration checklist](solid-restoration-checklist.md), and
[verification record](r1-verification.md). There is one worker authority and no
legacy UI adapter.

The implementation is native to the exactly pinned Effect 4 beta
(`effect@4.0.0-beta.107`) at the application-workflow boundary. This is an
unstable prerelease API; dependency updates require an explicit migration.
`InboxProviderService`, `InboxRepositoryService`, and `InboxEngineService` are
composable layers in one worker `ManagedRuntime`. Engine semaphores, shared
flights, identity, hydration, and commands are Effects. Bootstrap and
subscription and shared producer fibers are owned by the engine layer scope.
Waiters join producer fibers without owning their cancellation; flight records
are removed only by their producer. Host commands use the worker runtime's
`runPromise`, and disposal interrupts its roots and engine-owned work. Provider
scope cleanup fails local pending/readiness operations, removes listeners, and
disconnects Ports; startup captures disconnect before runtime activation and
cleans up if initialization fails or is interrupted.
Repository Promises
are wrapped once at the IndexedDB boundary, while Port callbacks/Promises and
the Promise engine facade are browser-host or test compatibility boundaries,
not a second orchestration model. Plain domain reducers and UI state do not
depend on Effect. IndexedDB commits plus account/worker epochs remain the
durable restart contract.

## Storage and projection

`lib/engine/resources.ts` defines the shared normalized facts, resource states,
errors, and repository contract. IndexedDB v4 preserves the v1/v2 inbox migration
and adds indexed history inventory, incremental references, chronological order,
physical page chunks, and one previous proven coverage per thread. Legacy
truncated history coverage is invalidated without discarding the inbox or global
revision. Resources own thread/user/message references and their current
participant/latest-message dependencies.

Head and opaque-cursor page segments are durable resources. A transaction writes
the affected segments/facts, removes explicitly evicted resources, prunes only
unreferenced facts, and advances one global revision. No Instagram request runs
inside the transaction. Fresh canonical state is published only after commit;
failure preserves the previous accepted projection and reports a storage error.

Refreshing a head does not delete unrelated history or later-page facts. Only
exact request/response cursor linkage establishes active contiguous ordering;
unlinked segments remain detached retained data until eviction. An unmatched
head refresh preserves one previous contiguous generation, including old-head
ownership and its own continuation frontier. Existing windows pin that generation;
explicit anchors resolve against current or proven previous coverage, never
arbitrary retained pages. Previous coverage is stale and exposes
`newerCoverageAvailable`; “Show latest messages” is explicit, not an automatic
jump. Previous coverage is retired when current coverage contains all its IDs.
Synthetic message identities are scoped to their stable conversation, consistently across
inbox previews and history, and are never treated as provider IDs.

Complete snapshots carry `entities`, an aggregate `inbox` resource, and bounded
`histories` keyed by stable thread ID, plus account/worker epochs and revision.
Each Port sees its inbox, selected detail, and at most two recently visited warm
histories—not the entire retained database. Sequence numbers are contiguous for
that Port, including after its selected interest changes. Gaps, worker restart,
and account reset recover through snapshots, without a durable replay log.

## Read ownership

The worker verifies `ds_user_id` before publishing persisted account data. The
provider checks identity around token preparation and network reads; mailbox
pagination identity is separately cached per account. History viewer identity
is not the storage account: an older-page fallback does not replace the viewer
established by initial detail. Cookie evidence cannot prove that every external
account switch is observable. Unknown-account offline reopening remains excluded.

The production provider exposes only account, inbox/page, and history/older reads.
Captured descriptors and response parsing live under `lib/instagram-api`.
Malformed successful HTTP/GraphQL envelopes are errors, not empty inbox/history
success. Anchor readiness remains owned by the reverse content-script Port.
Complete existing Instagram tabs without a live provider Port receive the compiled
MAIN/ISOLATED scripts using host-scoped `scripting` permission; no user tab reload
is required. Never reinject a healthy provider: WXT invalidates its prior content
context before the initializer runs, interrupting pending RPCs.

Cached history is hydrated before fetching missing content; explicit refresh is
separate from opening a retained conversation. Read flights are shared by
account/resource/cursor, with bounded history concurrency and per-interest
generations. Last history interest synchronously invalidates its generation and
detaches flights, then interrupts those producers outside the commit lane.
Account reset also invalidates identity/bootstrap evidence, including when the
account becomes unknown. Stale completions cannot replace a current projection.
Hydration and commit acceptance are serialized; hydration reads, network, and
lane waits remain interruptible. Started persistence, revision/entity installation,
and publication reconcile uninterruptibly before lane release or repository close.
Account guards also cover storage failures. Overlapping reads preserve facts
accepted from a later-started request.

Continuation errors retain usable data, identify the failed operation, and
require explicit Retry. Cyclic cursors and successful non-progress continuations
are failure-gated. Retention limits are distinct from server exhaustion and must
also gate programmatic continuation, not merely disable a UI button. The current
durable policy retains every successfully loaded page, splitting oversized
responses into physical chunks. Each admitted client window is at most 400 IDs;
there are at most 20 admitted detail windows and two warm windows, independently
of durable history size. Indexed hydration reads at most 400 IDs/facts plus their
dependencies. Cached older/newer traversal precedes networking. Durable inventory
controls whole-history inactive LRU eviction under soft account pressure, protecting
interested histories and two recent inactive histories. Inbox previews survive
through independent references. Projection and DOM bounds remain independent.

## Exclusions and evidence

The R1 path is read-only. It provides no mutation/outbox, automatic read marking,
polling, media player/comments, replay log, or offline account chooser. Small
global settings will use one `storage.local` owner when a consuming feature ships.
Media bytes and auth secrets are not persisted.

Repository/engine tests use `fake-indexeddb` and controlled providers; browser
fixtures exercise the built Solid page with a mocked Port. These are not live
Instagram or installed-extension lifecycle evidence. R0 release gates remain
explicit in the verification record.
