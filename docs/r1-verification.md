# R1 restoration verification

Latest evidence: [2026-09-30 fixes and production retest](#fixes-and-production-retest--2026-09-30).
Earlier counts, sizes, limits, defects, and unavailable-browser statements below
are historical checkpoints, not the current implementation.

## Fixes and production retest — 2026-09-30

### Implementation and quality gates

**173 tests pass**, with zero failures, cancellations, or skips. Lint, TypeScript
check, production build, and `git diff --check` pass. The prescribed shared
ast-grep scan exits 0 with **102 warnings**, predominantly long-function
paragraph grouping; it is not diagnostic-free. No suppression was added.
The exact Effect pin and worker authority remain unchanged.

Fixed identity-gated capacity/fresh subscriptions, trusted same-Port replacement
credit, shared hydration cancellation, timed-out anchor-acquisition retry,
canonical bounded-delta merging, malformed routes, separator geometry, logical
scroll/focus restoration, unsupported selection attributes, and Solid effect
compute/apply dependency capture. Detached scroll events and native scroll
anchoring no longer overwrite restored positions.

IndexedDB v4 retains complete pages independently of 400-ID client windows and
80 mounted history rows. Repository/engine regressions cover >1,200 loaded
messages, restart, independent readers, oversized pages, exact-cursor coverage,
whole inactive-root eviction, transitive inbox references, and account isolation.
An unmatched refreshed head now preserves one previous proven generation,
including old-head ownership, bounded indexed reads, and its own frontier.
Old readers remain stale with explicit “Show latest messages”; arbitrary archives
never establish coverage. Order-index and archive cleanup are bounded.

Production startup additionally recovers an already-open Instagram tab without
reloading it. Reinjection is skipped for a live worker-owned provider Port:
WXT constructs and invalidates contexts before `main`, so an initializer-only singleton
was insufficient and interrupted concurrent reads. A new-worker checking snapshot
with a positive global account epoch no longer masquerades as authoritative
logout; real auth failure still clears the prior route.

| Production entry | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| UI `ui-BH5i0vS1.js` | 87,738 | 29,553 |
| CSS `ui-DRMqBGca.css` | 5,709 | 1,773 |
| Worker | 163,043 | 50,048 |
| Instagram provider | 102,578 | 32,752 |
| MAIN auth probe | 1,851 | 922 |

UI JS/CSS gzip growth from the original baseline is 6,559 bytes, within the
provisional +15 KiB budget. Total production output is approximately 361.85 kB.

### Installed production-build evidence

Built output was installed unpacked from ignored `.dev/production-verification`,
not served by WXT. Chrome 154.0.0.0, macOS 27.0 arm64, Apple M4 Pro; the existing
authenticated browser profile and durable cache were retained. No private names,
message contents, cookies, tokens, screenshots, or profile exports were recorded.
This is locally installed production-build evidence, not a packaged/Web Store
release result. Browser Developer mode had to be enabled: Chrome rejected the
unpacked installation as `unsupportedDeveloperExtension` while it was off.
The intermediate disabled-extension/CDP crashes were environment failures;
after enabling it, toolbar launch and extension reload were retested successfully.

- Toolbar opens Messages after actual extension reload; the existing Instagram
  tab reconnects without navigation or login changes. Inbox mounts 15 rows.
- `#/thread/%` leaves a working inbox, with no URI or reactivity halt.
- At 720 px, separator End is 392 px: 392 + 8 + 320 = 720, no overflow.
- Compact Back restores measured scrollTop 449 → 449 and selected-row focus.
  The current 15-row inbox clamps larger requested offsets; it does not contain
  enough rows for the historical 720 px scenario. Fixture coverage tests it.
- History mounts at most 80 rows; selection uses `aria-current`, not invalid
  button `aria-selected`. Actual selected history retained 160 IDs in v4.
- Offline emulation targeted the Instagram provider tab. Cached 80 rows remain,
  Retry appears, and restoring connectivity plus Retry clears the error.
- Actual `ServiceWorker.stopWorker` transitions through running/stopping/stopped/
  starting; `workerEpoch` changes, the logical route survives, 80 rows recover,
  and no alerts remain.
- Two installed UI windows refresh one thread under 1,500 ms provider latency:
  **one** detail request. Closing one waiter leaves the other with 80 rows and
  zero alerts. This was rerun after fixing the reinjection race.
- Equivalent navigation/reselection emits zero observed `STRICT_READ_UNTRACKED`,
  `REACTIVITY_HALTED`, and URI errors. Zero mutation requests were observed;
  this alone does not prove server unread-state nonregression.

Provisional, continuously authorized measurements (no fixtures): 12 warmed
alternating selections, programmatic click to the next ready animation frame,
**p95 8.4 ms**; five real worker stops followed by retained-history readiness,
**p95 80.4 ms**, including CDP/epoch-probe/poll overhead. These are below the
100/300 ms warm/retained-cold targets, not a general missing-history benchmark.
Provider emulation was reset and duplicate test windows were closed.

### Remaining acceptance gates

R0/R1 remain open and R2 remains blocked. Account switch/logout, unknown-identity
offline cold open, missing-history p95, real delayed-network-image anchoring,
server unread-state nonregression, and live >400-message/pressure-eviction
acceptance remain unverified. The authenticated live history used here had 160
messages; >1,200 and changed-head/restart evidence is production-code fixture
coverage, not fabricated live evidence. Historical development-extension and
synthetic image-resize evidence below remain separately labeled.

## Baseline — 2026-09-13, before R1 edits

Source baseline: `032e781`; macOS 15.7.7 arm64, Apple M4 Pro, Node v24.19.0.
Fixture browser: Playwright Chromium 139.0.7258.5, headless (not the user's
authenticated desktop browser).

The read-only first-page Solid runtime passed `npm run lint`, `npm test` (71
tests), `npm run check`, `npm run build`, and the shared ast-grep scan. This
supersedes the historical successor review's scan failures; those are not current
issues to fix again.

Production Chrome MV3 output, measured with Node `gzipSync` (bytes):

| Entry                            |    Raw |   Gzip |
| -------------------------------- | -----: | -----: |
| UI JavaScript (`ui-Dic-Ve6l.js`) | 69,435 | 23,997 |
| UI CSS (`ui-BTMnOv5P.css`)       |  1,798 |    770 |
| Worker                           | 18,797 |  5,767 |
| Instagram content provider       | 39,272 | 12,207 |
| MAIN-world auth probe            |  1,768 |    891 |

The incremental UI target is no more than +15 KiB gzip against these UI JS/CSS
entries, not against the larger retired Teact product. Timing targets remain
provisional until input-to-visible measurements identify fixture, browser,
hardware, and identity/cache readiness.

## Evidence boundaries

### Verified R1 bundle

A production build after integration passed and produced the following bytes
(same Node `gzipSync` measurement as baseline):

| Entry                            |    Raw |   Gzip |
| -------------------------------- | -----: | -----: |
| UI JavaScript (`ui-y74BUWir.js`) | 85,670 | 28,885 |
| UI CSS (`ui-CusUMNcZ.css`)       |  5,440 |  1,712 |
| Worker                           | 41,514 | 12,158 |
| Instagram content provider       | 41,625 | 12,949 |
| MAIN-world auth probe            |  1,768 |    891 |

Combined UI JS/CSS increased by **5,830 gzip bytes**, below the provisional
+15 KiB incremental budget. This is a bundle-size result, not a navigation-latency
or installed-extension readiness result.

### Completed targeted checks during integration

- Provider/live-reader fixtures: 12 passing tests for account checks, mailbox
  partitioning, exact descriptor variables, malformed success responses, valid
  empty connections, intentionally suppressed message edges, and authentication
  classification. The older-message descriptor is shared with the catalog;
  duplicate reconstructed protocol variables were removed.
- IndexedDB fixtures: 10 passing repository tests executed locally for v1
  migration/abort, revision preservation, versionchange lifecycle, transitive
  references, partition isolation, pruning, and rollback. These do not substitute
  for the worker's multi-resource scheduling tests.
- The combined repository, provider, read-descriptor, catalog, and handler run
  passed 49 tests. The v1 fixture includes an orphan fact excluded from migrated
  inbox ownership and pruned by the subsequent resource write.
- The engine/protocol/actual client-Port coverage includes 18 focused tests for
  retained and missing detail while inbox refresh is deferred, coherent detail
  hydration, reselect generation rejection, queued shared interest, exhausted
  continuation, write-failure preservation, runtime error isolation, and bounded
  history retention. The Port test exercises the real registration function,
  including selected thread forwarding and sequence continuity across routes.

### Final quality gate — 2026-09-13

`npm run lint`, `npm test` (**106 passed, zero failures/cancellations**),
`npm run check`, `npm run build`, `git diff --check`, and
`ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .` all passed.
The shared scan produced no diagnostics.

An earlier full run timed out in the new history browser suite. A history effect
used a missing resource's optional `threadId` as its route identity, repeatedly
resetting a tracked range while history was absent. It now tracks the stable
route thread ID; late hydration chooses a bounded newest window rather than
mounting the complete retained range. The late-mount/short-fill regression and
the complete suite pass after this fix. The earlier timeout is resolved, not
reclassified as pre-existing.

The seven history browser tests cover cached local traversal, same-ID prepend
anchoring, compact/browser Back, message variants, late hydration and error-gated
short fill, pointer/keyboard resizing, and safe direct-link Back. Existing inbox
browser tests still cover stable rows, cached errors, gaps, and reconnects.

R1 remains in progress because the current 400-message durable ceiling is
transitional. `icr-itlg` now specifies complete loaded-history retention for the
active and recent conversations, with whole inactive-history LRU eviction under
account-level storage pressure; it explicitly rejects moving per-conversation
ranges as unnecessary complexity. No missing/warm/retained-cold p95 navigation
measurement was collected; the 100/300 ms targets remain unverified. No
speculative prefetch scheduler was introduced.

### Live versus fixture evidence

The baseline browser suite serves the built `/ui.html` with a mocked extension
Port. Repository tests use `fake-indexeddb`; provider tests use controlled
responses. None proves current Instagram endpoint availability or installed
extension worker lifecycle behavior. R0.5–R0.7 remain the release-evidence gate;
an unavailable live account must be recorded rather than represented as a pass.

On September 13 the session's desktop browser service reported
`browser.disconnected`. The separate Chrome DevTools connection was accessible,
but listed no Instagram or extension UI tab. No authenticated Instagram account or
installed-extension path was verified. Live endpoint, account-switch,
browser-action, and worker-termination evidence therefore remains unverified;
fixture tests must not be relabeled as those checks.

## Manual assessment — 2026-09-30

Source: `260c6bc` plus the current uncommitted Effect lifecycle changes; the
running WXT development extension, not an installed production build. Browser:
Chrome 154.0.0.0 on macOS 27.0 arm64. Desktop viewport 1452×861; compact 600×800;
sidebar edge case 720×800. Inspected through Chrome DevTools MCP, with local
Playwright/CDP sessions for read-request counts and actual worker termination.
An authenticated Instagram session was available. No private names, message
contents, cookies, tokens, or screenshots are retained in this report.

### Live development-extension results

| Scenario | Evidence / result |
| --- | --- |
| Toolbar launch | Triggering the extension action increased the number of Messages tabs by one. |
| Provider startup | Existing-tab startup loaded the inbox; closing the sole Instagram tab and refreshing created a replacement anchor and recovered. With two Instagram tabs, one history refresh produced request counts `[1, 0]`, HTTP 200, and usable history. |
| Cached navigation/reload | Two retained conversations rendered during switching without a loading state. CDP-confirmed reload of a retained conversation rendered 19 rows with zero additional history requests. |
| Shared interest | Two windows selected the same uncached conversation with 1500 ms network latency. Closing one while loading left exactly one `IGDThreadDetailQuery`; the other rendered 19 rows with no alerts. |
| Cancellation | Left another uncached conversation after its request started. The old transport finished, but its history was not committed to IndexedDB; the replacement selection retained 19 rows with no alerts. |
| Actual worker termination | Stopped the worker during a throttled history request using `ServiceWorker.stopWorker`. Observed running → stopping → stopped → starting → running, changed `workerEpoch`, and recovery to 19 retained rows with no alerts. This was not extension reload or `ManagedRuntime.dispose()`. |
| Failure/retry | Offline history refresh retained usable rows and exposed Retry. Restoring connectivity and explicit Retry recovered. A cached inbox error observed around restart also recovered through explicit Retry; no stuck loading was observed. |
| Compact Back | Focus restored, but saved inbox `scrollTop` 720 restored to 718: a 2 px discrepancy requiring correction. |
| Older/newer history | Older traversal stayed bounded; local newer traversal moved the previous reading boundary 3805 px above the viewport even though its row remained mounted. Failure tracked in `icr-w08c`. |
| Resize/route handling | At 720 px, separator End selected 400 px, yielding 400 + 8 + 320 = 728 px and horizontal overflow. `#/thread/%` rendered an empty body and threw URIError / REACTIVITY_HALTED. Both tracked in `icr-w08c`. |
| Image measurement | A synthetic 160 px growth of an already-loaded image above the visible anchor produced 0 px anchor drift; image style was restored. This is ResizeObserver evidence, not full delayed-network-image coverage. |

Observed at most 80 mounted history rows and 22 inbox rows in the inspected
flows. This is not a retained-history inventory, worker-memory, quota, or p95
measurement. Network/viewport overrides and synthetic image changes were reset;
assessment-created duplicate action tabs were closed. The Instagram session was
not logged out or changed.

### Controlled reproductions and code review

- **Critical authorization (`icr-nel3`):** bootstrap account A with 21 fixture
  threads, defer renewed identity, fill 20 detail interests, and add one more.
  The capacity-rejected snapshot exposes account A and all 21 retained thread
  facts before verification. This is reproduced against current engine layers;
  no live cross-account data was manipulated.
- **Lifecycle (`icr-7sjz`, reopened):** defer `readResources(history:a)`, release
  the last a interest, then select b and Refresh. After 20 scheduler checkpoints,
  the obsolete hydration remains active, b hydration has not started, and Refresh
  cannot finish because the old read holds the serialized lane. Runtime disposal
  does interrupt it. Subscription hydration is not among the detached flights.
- **Anchor retry (`icr-7sjz`):** an unresolved `ensureAnchor` makes initial account
  and explicit retry both time out, with only one anchor acquisition. Timeout
  does not retire the shared Promise, so Retry cannot acquire a fresh anchor.
  Controlled reproduction only; no browser API hang was observed.
- **Solid diagnostics (`icr-45nb`, new):** live dev console emitted
  STRICT_READ_UNTRACKED from the ConversationPane effect apply phase, repeated
  5139 times during navigation. Required reactive values should be passed from
  compute; no functional stale-render or UI hang was established from this warning.
- **Retention (`icr-tbbg` / `icr-itlg`):** static review still finds wrong-edge
  partial-page truncation with a full continuation cursor and retention accounting
  based on hydrated rather than all durable history roots. Complete active/recent
  history and whole inactive-history eviction remain unimplemented.

### Quality gates and remaining release evidence

Current run: **129 tests passed**, zero failures/skips/cancellations; lint,
typecheck, production build, and `git diff --check` passed. Shared ast-grep scan
exited 0 with **69 warnings**, not a clean diagnostic-free scan. Latest production
build sizes (bytes, Node gzip): worker 141208 / 44518; content provider
101939 / 32534; UI JavaScript 85945 / 29044. These are build measurements; that
production package was not installed for the browser checks above.

R0 remains in progress: production-installed verification, account switching/
logout, unknown-identity offline cold reopening, and missing/warm/retained-cold
navigation p95 remain unverified. R1 remains in progress: authorization,
lifecycle follow-ups, navigation/diagnostics, and complete retention acceptance
are open. R2 remains blocked by R1. The worker-authority architecture and existing
milestone ordering do not need replacement.
