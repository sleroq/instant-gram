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
subscription fibers are owned by the engine layer scope. Repository Promises
are wrapped once at the IndexedDB boundary, while Port callbacks/Promises and
the Promise engine facade are browser-host or test compatibility boundaries,
not a second orchestration model. Plain domain reducers and UI state do not
depend on Effect. IndexedDB commits plus account/worker epochs remain the
durable restart contract.

## Storage and projection

`lib/engine/resources.ts` defines the shared normalized facts, resource states,
errors, and repository contract. IndexedDB v2 migrates the v1 first-page inbox
without changing its account identity or global commit revision. Resources own
references to thread, user, and message facts; retaining a thread also retains
its current participant and latest-message dependencies.

Head and opaque-cursor page segments are durable resources. A transaction writes
the affected segments/facts, removes explicitly evicted resources, prunes only
unreferenced facts, and advances one global revision. No Instagram request runs
inside the transaction. Fresh canonical state is published only after commit;
failure preserves the previous accepted projection and reports a storage error.

Refreshing a head does not delete unrelated history or later-page facts. Only
exact request/response cursor linkage establishes active contiguous ordering;
unlinked segments remain detached retained data until eviction. Synthetic
message identities are scoped to their stable conversation, consistently across
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

Cached history is hydrated before fetching missing content; explicit refresh is
separate from opening a retained conversation. Read flights are shared by
account/resource/cursor, with bounded history concurrency and per-interest
generations. Stale completions cannot replace a current projection. Hydration
and commit acceptance are serialized; overlapping reads preserve facts accepted
from a later-started request.

Continuation errors retain usable data, identify the failed operation, and
require explicit Retry. Cyclic cursors and successful non-progress continuations
are failure-gated. Retention limits are distinct from server exhaustion and must
also gate programmatic continuation, not merely disable a UI button. The current
400-message/20-segment history ceiling is transitional implementation state, not
the intended durable policy. `icr-itlg` replaces it by retaining complete loaded
history for active and recent conversations and evicting whole inactive histories
under account-level pressure. Projection and DOM bounds remain independent.

## Exclusions and evidence

The R1 path is read-only. It provides no mutation/outbox, automatic read marking,
polling, media player/comments, replay log, or offline account chooser. Small
global settings will use one `storage.local` owner when a consuming feature ships.
Media bytes and auth secrets are not persisted.

Repository/engine tests use `fake-indexeddb` and controlled providers; browser
fixtures exercise the built Solid page with a mocked Port. These are not live
Instagram or installed-extension lifecycle evidence. R0 release gates remain
explicit in the verification record.
