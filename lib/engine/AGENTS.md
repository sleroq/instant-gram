# Engine and repository

Read [application architecture](../../docs/application-architecture.md) for
ownership. Keep canonical state, identity, scheduling, persistence, and operation
settlement here; provider protocol and UI geometry stay outside.

## Lifecycle and identity

- Construct the engine in an Effect scope using the shared worker runtime.
  Bootstrap, subscriptions, and shared producers belong to that scope.
  Tests substitute services in the same runtime assembly.
- Shared producer fibers belong to the scoped `FiberSet`, not command waiters;
  only producers remove flight records. Share by account/resource/cursor.
- Last history interest synchronously invalidates generations and detaches
  flights, then interrupts producers outside the commit lane.
- Keep account/epoch/generation guards authoritative, including on storage
  failures. Account reset invalidates bootstrap evidence even on unknown identity.
- Hydration, network, and lane acquisition stay interruptible. Once persistence
  starts, reconcile commit revision, entity installation, and publication
  uninterruptibly before lane release or repository closure.
- Serialize hydration acceptance with commits; discard and reread stale results.
  Overlapping reads cannot overwrite facts accepted from later-started requests.
- Verify provider identity before publishing persisted data; never reopen an
  unknown account. History viewer identity is separate: older-page fallback may
  fill a missing viewer, not replace initial-detail evidence.

## Resources and retention

- Normalize stable IDs and maintain transitive references, including current
  thread participants/latest message. Synthetic IDs are conversation-scoped and
  never usable as provider IDs or receipt evidence.
- Commit affected segments/facts, explicit evictions, reference pruning, and one
  global revision atomically. Publish fresh facts only after commit; preserve
  accepted content on storage failure. Never run network inside transactions.
- History headers do not own inbox pin metadata or downgrade newer inbox
  activity/preview. Updating one resource must not orphan another's dependencies.
- Hydrate retained history before fetching missing content. Opening is not an
  implicit refresh. Keep availability, freshness, and synchronization independent.
- Only exact request/response cursor linkage proves contiguous coverage.
  Unlinked segments remain detached retained data, not active ordering.
- An unmatched head refresh preserves one previous proven generation with its
  own frontier and old-head ownership. Existing windows pin it; anchors resolve
  only against current or proven previous coverage, never arbitrary pages.
  Expose `newerCoverageAvailable`; current adoption is explicit. Retire previous
  coverage when current coverage contains all its IDs.
- Failures belong to head refresh or the exact continuation cursor. Head refresh
  must not clear an active continuation error. Cyclic/no-progress cursors are
  failure-gated until explicit retry. Enforce retention gates programmatically.
- Keep provider exhaustion distinct from local retention capacity.
- Retain loaded history pages, splitting oversized responses into physical
  chunks. Under soft account pressure, evict whole inactive LRU histories;
  protect interested histories, two recent inactive histories, unsettled
  operations, and independently referenced facts.
- Bound each admitted history window and indexed hydration to 400 IDs/facts plus
  dependencies; admit at most 20 detail windows and two warm histories.
  Snapshots include only the client's inbox, selected detail, and warm set.
  Durable retention and the UI's 80-row mount bound are separate policies.
- Use cached older/newer traversal before networking. Newer traversal is local.
- Keep snapshot data/revision coherent and Port sequences contiguous across
  interest changes. Recover gaps and epoch changes with snapshots, not replay logs.

## Commands and synchronization

- Persist immutable account-scoped intent and overlay before dispatch. Identical
  operation redelivery deduplicates; different payload reuse is rejected.
- Replay ordered overlays over canonical facts using the shared pure projector.
  Receipt, canonical facts, and settlement commit atomically. Match target and
  requested state; serialize conflicting targets, not all commands globally.
- Preserve durable queued, dispatching, succeeded, failed, outcome_unknown, and
  removed states. Retry only explicitly eligible operations; never blindly retry
  unknown sends. Storage failure rejects acceptance before dispatch.
- Bound runtime/snapshot retention to 200 active commands and 200 settled send
  aliases. Resolve alias anchors here. Immutable persisted dedup tombstones have
  no expiry; do not claim bounded durable operation storage or invent a policy.
- Pins reconcile receipts and acceptance order. Read commands coalesce seen
  watermarks, including a proven seen message superseded by an arrival. Fresh
  matching canonical read state can settle a failed read without replay.
  Never mark unseen arrivals/background fetches read or infer exact unread counts
  from boolean `isUnread` or a local watermark.
- Poll only for visible interested clients; stop without interests. Current
  5-second interval/60-second backoff cap are policy, not measured freshness.
  Refresh/Retry are explicit repair controls, not a second synchronization owner.

Test transactions, migrations, restart, account isolation, stale completions,
shared-flight cancellation, cursor coverage, retention, revisions, and durable
command safety at this boundary. Future scope belongs in
[the roadmap](../../docs/roadmap.md), not additional speculative engine schemas.
