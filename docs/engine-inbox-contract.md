# Inbox and conversation engine contract

**Status:** R2 complete by user acceptance; automated checks pass. Read with the stable
[application contract](application-architecture.md),
[restoration checklist](solid-restoration-checklist.md), and
[R2 verification record](r2-verification.md). There is one worker authority and no
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
Repository Promises are wrapped at the IndexedDB boundary; Port callbacks and
Promise commands enter through the worker runtime. Engine tests use the same
runtime assembly with substituted services, not a second engine constructor.
Plain domain reducers and UI state do not depend on Effect. IndexedDB commits plus account/worker epochs remain the
durable restart contract.

## Storage and projection

`lib/engine/resources.ts` defines the shared normalized facts, resource states,
errors, and repository contract. IndexedDB v5 adds the operation store and preserves the v1/v2 inbox migration
and adds indexed history inventory, incremental references, chronological order,
physical page chunks, and one previous proven coverage per thread. Legacy
truncated history coverage is invalidated without discarding the inbox or global
revision. Resources own thread/user/message references and their current
participant/latest-message dependencies.

History headers do not own inbox pin metadata and cannot downgrade a newer
inbox activity/preview. A read intent may target a proven seen history message
even if a newer inbox message arrives before acceptance; only the seen watermark
advances. Fresh matching canonical read state can settle a failed read without
replaying it.

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
`histories` keyed by stable thread ID, bounded operations, plus account/worker epochs and revision.
Each Port sees its inbox, selected detail, and at most two recently visited warm
histories—not the entire retained database. Sequence numbers are contiguous for
that Port, including after its selected interest changes. Gaps, worker restart,
and account reset recover through snapshots, without a durable replay log.

## Read ownership

The worker verifies `ds_user_id` before publishing persisted account data. The
provider checks identity around token preparation and network reads; mailbox
pagination identity is separately cached per account. History viewer identity
is not the storage account: an older-page fallback does not replace the viewer
established by initial detail. Read-receipt actor identity comes from the
MAIN-world `PolarisViewer.data.fbid`, not a storage/profile ID or token segment.
The versioned auth bridge replaces its previous listener on reinjection.
Cookie evidence cannot prove that every external
account switch is observable. Unknown-account offline reopening remains excluded.

The production closed provider exposes account, inbox/page, history/older reads,
and R2 send/reply, pin/unpin, and paired read methods. Captured descriptors and
strict receipt parsing live under `lib/instagram-api`; R3 interactions and R4
media capabilities remain future scope. R2 acceptance and live diagnostic evidence
are recorded separately from automated fixtures. Authentication requests a fresh MAIN-world
probe for page-module tokens and reads cookies in the content script. It does not
scan HTML or script payloads, substitute the storage account for the message
viewer, or retain diagnostic token-source metadata.
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

## Durable commands and synchronization

IndexedDB v5 records immutable account-scoped intent before any dispatch. Identical
operation redelivery deduplicates; conflicting payload reuse is rejected. Receipt,
canonical facts, and operation settlement commit atomically. Per-target dispatch
serialization and account/epoch guards remain worker-owned. Ordered overlays are
replayed over canonical facts by the shared pure projector.

Runtime/snapshot retention is bounded to 200 active commands and 200 settled send
aliases. Immutable deduplication tombstones persist indefinitely: the persisted
operation log does **not** have finite retention. This is a known storage-growth
tradeoff, not a bounded-database claim. Browser quota/write failure rejects new
acceptance before dispatch. No expiry or clear product policy has been invented.
Retained send alias anchors resolve to canonical IDs in the worker.

Queued, dispatching, succeeded, failed, outcome_unknown, and removed are durable
operation statuses. Retry requires explicit safe eligibility; unknown sends are
never blindly retried. Pins reconcile authoritative receipts and local acceptance
order. Paired read marking coalesces watermarks and targets only the latest message
actually seen; arrivals must not be implicitly marked read.

The worker polls inbox/selected history for visible interested clients, stopping
without those interests. The initial 5-second interval and capped 60-second
backoff are configured targets, not production measurements. Refresh/Retry remain
repair controls. No client polling or always-on alarm authority is introduced.

## Exclusions and evidence

Media player/comments, R3 reactions/edit/forward, R5 settings, a durable client-stream
replay log, and an offline account chooser remain excluded. Media bytes and auth
secrets are not persisted. Future small global settings have one `storage.local`
owner when their consuming feature ships.

Repository fixtures and mocked-Port browser tests are not live Instagram or
installed-extension lifecycle evidence. R0–R2 are complete by user acceptance;
R2 acceptance closes its testing gate without extending the agent's independent
per-scenario measurements. See [R2 verification](r2-verification.md).
