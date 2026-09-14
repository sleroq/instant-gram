# R1 restoration verification

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
