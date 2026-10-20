# R2 local implementation and verification

**Status: R2 complete by user acceptance.** After the read acknowledgement and
sidebar refresh fixes, the user confirmed everything seems good and authorized
completion of testing-blocked work. The R2 testing/acceptance gate is closed;
R3 is next. This is user acceptance, not an additional agent-run live test or new
per-scenario measurement. R0/R1 acceptance remains recorded in
[R1 verification](r1-verification.md).

## Implemented architecture

- One worker owns durable outbox acceptance, identity, serialization, retries,
  canonical settlement, and visible-interest synchronization. Solid owns
  per-window/per-thread drafts, reply intent, focus, and logical scroll state.
- IndexedDB v5 adds the operation store. Immutable account-scoped commands are
  persisted before dispatch; identical redelivery deduplicates, conflicting ID
  reuse is rejected. Receipt, canonical facts, and settlement are atomic.
- A shared pure projector applies ordered overlays to canonical facts. Snapshots
  include bounded operations: 200 active commands plus 200 settled send aliases.
  Retained alias-to-canonical anchors resolve in the worker. These are runtime
  bounds, not a finite persisted-log retention guarantee.
- Statuses are `queued`, `dispatching`, `succeeded`, `failed`, `outcome_unknown`,
  and `removed`. Pending/failed controls offer only eligible safe retries and
  removal. Unknown send outcomes are never blindly retried, including on restart.
- Send/reply, authoritative pin/unpin, and paired read methods are implemented.
  Read watermarks target only the latest message actually seen; opening history
  alone or receiving a newer message must not mark that newer message read.
- Worker polling follows visible inbox/detail interests and stops without them.
  Initial 5 seconds and capped 60-second backoff are configured policy targets,
  **not production-measured freshness**. Refresh remains repair/retry, not the
  routine synchronization mechanism. No independent UI polling authority exists.
- Inbox DOM stays at most 31 fixed 72px rows; history stays at most 80 rows.
  Previews remain previews, not a player. R3 reactions/edit/forward, R4
  media/player/comments, and R5 settings remain future scope.

## Known persistence tradeoff

Immutable deduplication tombstones are preserved indefinitely. Runtime operation
retention is bounded, but the persisted operation log has **no finite retention**
policy and can grow with use. Browser quota/write failure rejects new acceptance
before provider dispatch. Explicit expiry/clear semantics are a future product
policy decision, not an implemented or invented cleanup guarantee. History LRU
retention does not imply operation-tombstone expiry.

## Automated verification

Fresh local checks passed with Bun 1.3.13 on macOS 27 arm64:

- `bun run test`: **188 passed, zero failed**, across 24 files. Browser coverage
  uses the built Solid page with mocked extension Ports, not a live account.
- `bun run lint`, `bun run check`, `bun run build`, and `git diff --check` passed.
- The repository-root shared ast-grep scan exited 0 with three warnings. Two
  identify the actual external command/intent validators; the third is an
  exception predicate in a provider test. Accepting unparsed input is necessary
  at those boundaries: each immediately narrows it. No suppressions were added.

Fixtures exercise immutable deduplication, quota rejection with zero dispatch,
atomic settlement, two-client convergence, interrupted-attempt recovery,
account changes during acceptance/dispatch/settlement persistence, visibility
polling and backoff with a test clock, paired read watermarks (including a new
message in the same millisecond), and bounded operation/history projections.
Browser checks cover IME/newline handling, unchanged-draft duplicate submission,
newer-draft preservation, lost acceptance delivery and same-ID reconnect,
explicit failed-command recovery, and bounded DOM. Sent-row aliases survive
receipts/echoes and resolve to canonical IDs for worker history anchors; old
aliases cannot resurrect unrelated history membership.

## Follow-up: read acknowledgements and sidebar refresh

Manual QA reported read marking succeeding while both a local rejection and a
failed durable read remained visible, and sidebar rows temporarily reordering
around refresh. The read failure was reproduced against the same already-read
conversation: both paired responses were HTTP 200 without GraphQL errors,
validation was `true`, and the receipt watermark matched the requested time.
The receipt participant did not match the old auth probe identity, but did match
`PolarisViewer.data.fbid`. Account/profile IDs did not match. Only these shape
and equality results were recorded; no identities, tokens, or message contents
were recorded.

The probe now uses that independently evidenced actor identity, not account IDs
or a token segment. Its versioned bridge and replaceable handler allow the fix
to replace an already-installed legacy probe without reloading Instagram.
Strict receipt validation remains in place. Fresh canonical confirmation of the
same latest message being read settles an earlier failed read without replay;
stale local rejection text is superseded by its durable operation or read state.
A seen message remains a valid read watermark when the inbox has advanced, but
cannot mark that newer message read.

Captured detail headers omit inbox pin metadata. Detail refreshes now preserve
inbox-owned pin state and cannot downgrade a newer inbox preview/activity.
Regression fixtures assert every emitted sidebar ordering, including while an
unchanged inbox refresh is unresolved. Browser fixtures cover duplicate local
and durable read errors and their cleanup.

Live retries only repeated read marking for the already-read conversation;
no messages were sent and no pins were changed. A complete fixed-build live
retest was not established: temporary verification hit CDP navigation/target
discovery failures. Temporary windows/copies were cleaned up; the two existing
installed extensions were retained. This was diagnostic evidence plus automated
regression coverage; subsequent user confirmation supplies R2 acceptance as
recorded above.

## Bundle evidence

A clean R1 baseline was reconstructed from
`17dc3d7aff2109f1f5aeb3b1aedcf37ffd65ad6b` in a temporary directory using the
same installed dependencies and production build command. This is a source
baseline comparison, not a comparison against a larger retired frontend.
Sizes below use Python gzip with `mtime=0`; they are not navigation benchmarks.

| Asset           | R1 gzip bytes | R2 gzip bytes |  Delta |
| --------------- | ------------: | ------------: | -----: |
| UI JavaScript   |        29,418 |        33,072 | +3,654 |
| UI CSS          |         1,771 |         1,877 |   +106 |
| Worker          |        49,778 |        56,342 | +6,564 |
| Provider        |        28,756 |        31,433 | +2,677 |
| MAIN auth probe |           728 |           728 |      0 |

The combined increase is 13,001 bytes (12.70 KiB), below the provisional
15 KiB incremental budget. The pure projector/limits do not import the worker's
Effect error runtime into the UI. UI JavaScript SHA-256:
`47908c0aa166970806b4186a055aee7bcc4c194ae7b45a447f7d9392369a78ac`.

## Evidence limits, not remaining R2 blockers

User acceptance closes the R2 testing gate. The agent did not independently
complete a full fixed-build live send/reply, pin/read, incoming synchronization,
or installed-extension restart/account-isolation matrix. No live messages were
sent by the agent; diagnostic read retries are scoped above. Production polling
latency, R2 end-to-end warm/cold navigation p95, and main-thread task budgets
have not been newly measured. User acceptance does not invent these measurements
or imply that every scenario was individually verified. These limits remain
recorded for future work, not as blockers to the accepted R2 milestone.
