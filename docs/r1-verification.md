# R1 restoration verification

**Stage accepted:** the user confirms this stage works and manual testing passed.
R0, R1, and complete-history retention are completed; R2 is unblocked and not yet
started. This is user acceptance, not an additional agent-run test or new
per-scenario measurement.

## Cleanup verification

After removing dormant API implementations and compatibility adapters, fresh
local checks passed: 138 tests, lint, TypeScript, production build,
`git diff --check`, and the shared ast-grep scan with no findings.

A temporary installation of the rebuilt production extension in the existing
authenticated browser loaded 15 inbox rows and 20 history rows. Loading older
messages produced 40 rows; explicit history refresh settled without alerts or
console warnings/errors. The compiled MAIN-world probe was also invoked against
the live page modules and supplied all required fields without HTML/script
scraping or diagnostic source metadata. Only field presence and counts were
recorded, not credentials or private content. The temporary extension and test
window were removed; the two previously installed copies were left untouched.
This does not extend the account-switch, offline, or pressure-eviction evidence
below, nor establish a new packaged release or performance benchmark.

## Recorded evidence

- Recorded quality checks passed: tests, lint, TypeScript, production build, and
  `git diff --check`. The shared ast-grep scan exited 0 with 102 warnings,
  predominantly long-function paragraph grouping; it was not diagnostic-free.
  No suppression was added. These are recorded results, not a fresh run.
- Repository/engine fixtures cover v1 migration, account isolation, transitive
  references, >1,200 loaded messages, restart, independent readers, oversized
  pages, exact-cursor coverage, whole inactive-history eviction, and unmatched
  head refresh preserving one previous proven generation. Fixture evidence does
  not establish live Instagram behavior.
- IndexedDB v4 retains complete loaded pages independently of 400-ID client
  windows and 80 mounted history rows. Soft account-pressure eviction protects
  interested histories and two recent inactive histories. Arbitrary retained
  archives do not prove contiguous coverage; previous-coverage readers remain
  stale with explicit “Show latest messages”. See the
  [engine contract](engine-inbox-contract.md).

## Installed production-build evidence

The unpacked production build was installed locally, not served by WXT and not
verified as a packaged/Web Store release. Recorded environment: Chrome
154.0.0.0, macOS 27.0 arm64, Apple M4 Pro, continuously authenticated browser
profile with retained durable cache. No private names, message contents, cookies,
tokens, screenshots, or profile exports were recorded.

- Toolbar launch and extension reload work; an existing Instagram tab reconnects
  without navigation or login changes.
- Malformed route `#/thread/%` preserves a working inbox. At 720 px, separator
  End is 392 px, leaving 8 px separator and 320 px conversation without overflow.
- Compact Back restores measured scrollTop 449 → 449 and selected-row focus.
  The live inbox has 15 rows; larger-offset restoration has fixture coverage.
- History mounts at most 80 rows. The selected live history retained 160 IDs.
- Provider-tab offline emulation retains cached rows and exposes Retry;
  connectivity restoration plus Retry clears the error.
- Actual `ServiceWorker.stopWorker` changes worker epoch while preserving the
  logical route and recovering 80 rows with no alerts.
- Two installed windows refreshing one thread under 1,500 ms provider latency
  share one detail request; closing one waiter leaves the other usable.
- Navigation/reselection showed no `STRICT_READ_UNTRACKED`, `REACTIVITY_HALTED`,
  or URI errors. No mutation requests were observed; this alone does not prove
  server unread-state nonregression.

Recorded provisional navigation measurements, without fixtures:

| Case                     | Measurement                           | Boundary                                                            |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| Warm                     | p95 8.4 ms, 12 alternating selections | Programmatic click to next ready animation frame                    |
| Authorized retained-cold | p95 80.4 ms, five actual worker stops | Retained-history readiness, including CDP/epoch-probe/poll overhead |

These are below the provisional 100/300 ms targets, not a missing-history
benchmark. Provider emulation was reset and duplicate test windows closed.
Recorded production gzip sizes were UI JS 29,553 bytes, CSS 1,773 bytes, worker
50,048 bytes, provider 32,752 bytes, and MAIN auth probe 922 bytes. These identify
the measured build, not a guarantee about future bundles.

## Evidence limits and future gates

User acceptance closes this stage; the following are limits of the agent's
independent evidence, not remaining R0/R1 blockers. Account switch/logout,
unknown-identity offline cold open, missing-history p95, real delayed-network-image
anchoring, server unread-state nonregression, and live >400-message/pressure-eviction
acceptance were not independently verified. The user supplied no further
per-scenario measurements. >1,200-message and changed-head/restart coverage is
production-code fixture evidence, not live-account measurement.

Unknown-identity offline reopening remains excluded by the current contract.
Future slices must keep fixture, installed/live, and user-acceptance evidence
separate; measure input-to-visible timing with identity/cache readiness included,
record unavailable scenarios, and run the checklist's quality gates. Mutations,
read marking, polling, media/player/comments, and settings remain future scope.
