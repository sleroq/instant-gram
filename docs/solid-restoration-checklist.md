# Solid restoration checklist

**R0, R1, and R2 are complete by user acceptance**, including complete-history
retention and the read acknowledgement/sidebar refresh follow-up fixes. The user
confirmed the corrected build works and closed testing-blocked R2 work.
**R3 — Full message interactions is next**; R4 media/player is also unblocked by
R2. Checked items record accepted capabilities; unchecked items remain future
requirements. User acceptance does not imply additional agent-run live tests or
new performance measurements. See the [frontend architecture](frontend-architecture.md),
[engine contract](engine-inbox-contract.md), and [R2 verification record](r2-verification.md)
for current ownership and evidence limits. Protocol types/parsers alone do not
establish a runtime feature; optional scope is not a restoration commitment.

## Ordering and ownership

Resource writes are atomic and reference-aware. Never replace all account facts
as a convenience for refreshing one resource.

Keep one canonical worker. The worker owns RPC, identity, persistence,
single-flight, resource generations, and canonical facts. Solid projects worker
state and owns only route, draft, focus, and scroll state local to its window.
Keep the shared `commitRevision` and current account identity rules. Distinguish
the `ds_user_id` storage account, message viewer identity, and thread
key/`fbid`/`igid`; none are interchangeable.

```mermaid
flowchart LR
  R0["R0 baseline"] --> R1["R1 resources + cached reads"]
  R1 --> R2["R2 durable core messaging"]
  R2 --> R3["R3 full interactions"]
  R2 --> R4["R4 media/player"]
  R1 --> R5["R5 cross-cutting and unfinished"]
  R3 --> R6["R6 optional product decisions"]
  R4 --> R6
```

Phases may be split into small vertical pull requests. Do not pre-create a
massive empty module tree.

## R0 — Current baseline and release evidence

### Implemented baseline

- [x] **R0.1 — Solid 2 runtime.** One `/ui.html` production page with no retired
      frontend authority.
- [x] **R0.2 — Read-only cache.** Account-authorized, normalized first-page
      snapshots are persisted in IndexedDB and explicitly refreshed/retried.
- [x] **R0.3 — Bounded inbox.** Stable domain keys, fixed 72 px rows, and at most
      31 mounted rows.
- [x] **R0.4 — Runtime checks.** The clean-restart runtime has focused tests,
      type/lint/build checks, and worker-owned identity/single-flight/stale-generation
      behavior.

### Accepted real-browser stage

The user confirmed this stage works and manual testing passed; R0/R1 are complete.
The [verification record](r1-verification.md) separates user acceptance from
agent measurements and preserves the limits of the recorded evidence.

- [x] **R0.5 — Installed extension path.** Record browser action launch,
      provider selection, account switch, and worker termination/restart in an
      unpacked build.
- [x] **R0.6 — Cache states.** Record fixture/bundle identity and missing, warm,
      and retained-cold navigation input metrics. Separate mocked test evidence from
      live-account evidence.
- [x] **R0.7 — Evidence boundaries.** Keep installed-extension/live-account evidence
      separate from fixtures and user acceptance; record unavailable scenarios
      rather than implying live verification. See [R1 verification](r1-verification.md).

Measured warm/retained-cold timings and bundle sizes are recorded separately;
user acceptance does not invent missing-history metrics or additional measurements.

## R1 — Resource-scoped persistence and cached conversation reads

### Persistence and resource protocol

| Checklist                                     | Lowest owner / implementation                                                                                                                                                                                    | Focused acceptance                                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x] **R1.1 — Migrate v1 storage.**            | `lib/engine/db.ts`: migrate existing first-page data into explicit `inbox:primary` ownership without changing account identity or `commitRevision`.                                                              | A v1 database opens with the same authorized inbox; migration is atomic and repeatable.                                                                                                                     |
| [x] **R1.2 — Resource-scoped writes.**        | Engine DB: generalized explicit keys (`inbox:primary`, page/cursor ownership, `history:<thread>`), resource-to-fact references, and reference-aware deletion. Never hold network work inside an IDB transaction. | Refreshing one resource neither deletes nor reorders facts still referenced by another; writes/deletions remain partition-isolated, and any explicit whole-partition clear is defined only when introduced. |
| [x] **R1.3 — Resource state.**                | Worker engine: per resource expose availability, freshness, sync state, cursor, exhaustion, last sync time, and typed error.                                                                                     | Missing, stale, refreshing, exhausted, and failed resources render distinctly without inventing cached success.                                                                                             |
| [x] **R1.4 — Scoped single-flight.**          | Worker: one read flight per account/resource/cursor, bounded client interests, and session generation as routes subscribe/unsubscribe.                                                                           | Two windows share a request; stale generations cannot commit; losing all interests ends eligible detail work.                                                                                               |
| [x] **R1.5 — Coherent snapshots.**            | Worker snapshot projector: retain account/worker epoch, client sequence, and global revision coherently across multiple resources.                                                                               | Gaps, duplicate/irrelevant commits, account changes, and snapshot races converge without cross-account state.                                                                                               |
| [x] **R1.6 — Keep full snapshots initially.** | Worker RPC: continue complete snapshots while payloads are small. Add scoped delta batches only after measurement.                                                                                               | No durable replay log, generic sync framework, or client-side canonical store is introduced speculatively.                                                                                                  |

### Inbox pagination

| Checklist                             | Lowest owner / implementation                                                                                           | Focused acceptance                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [x] **R1.7 — Page resources.**        | Provider/parser preserve each exact opaque cursor; engine merges ordered thread IDs while retaining page ownership.     | Loading page 2 keeps page 1 and server pin facts; refresh does not erase history. Durable pin ordering begins in R2. |
| [x] **R1.8 — Progress gates.**        | Engine cursor state detects duplicate cursors and successful responses that add no progress.                            | Duplicate/no-progress becomes a visible retryable resource failure, never an uncontrolled request loop.              |
| [x] **R1.9 — Explicit continuation.** | Solid sends a load-more intent for the resource; the worker selects its current opaque cursor and provides retry state. | Previous pages stay usable while the next page fails or retries; UI never owns cursor selection.                     |

### Selection, routes, and layout

| Checklist                                      | Lowest owner / implementation                                                                                                   | Focused acceptance                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [x] **R1.10 — Cached selection.**              | Worker history subscription plus Solid route state opens cached facts first, then explicitly synchronizes.                      | Selecting a row does not discard inbox position and does not require a network response to show retained history. |
| [x] **R1.11 — Responsive route.**              | Solid: two panes on desktop; one real history route on compact screens with Back.                                               | Compact Back restores list window and keyboard focus; it is not a CSS-hidden second pane.                         |
| [x] **R1.12 — Resizable desktop sidebar.**     | Pointer/keyboard separator in Solid, initially window-local, clamped 280–520 px while leaving at least 320 px for conversation. | Pointer capture cleanup and keyboard resizing work; persistence waits for the global-settings service.            |
| [x] **R1.13 — Basic dark visual restoration.** | Solid tokens/media query, independently from a generic settings framework. A light/system choice is an optional later setting.  | All shipped dark surfaces are legible; no settings framework or empty rail placeholders are required.             |

### Bounded history and scrolling

IndexedDB v4 retains every successfully loaded page independently of runtime
bounds. Under soft account storage pressure, evict whole least-recently-used
inactive histories, protecting interested histories and two recent inactive
histories. Inbox previews retain independent references. Client windows are at
most 400 IDs; Solid mounts at most 80 history rows. An unmatched head refresh
preserves one previous proven contiguous coverage and its frontier. Retained
archives alone never establish cursor coverage; showing latest is explicit.

| Checklist                            | Lowest owner / implementation                                                                                                                           | Focused acceptance                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [x] **R1.14 — History resource.**    | Engine/provider/parser: `history:<thread>` starts at newest and persists exact older cursors and normalized facts.                                      | Initial history is bounded and survives inbox refresh/account-safe restart.                                                                   |
| [x] **R1.15 — Local-first ranges.**  | Solid history projection asks for newer/older logical IDs already cached before network. Use a 40-message slice and mount no more than 80 message rows. | Scrolling within cached coverage performs no request and never expands the mounted window without bound.                                      |
| [x] **R1.16 — Logical restoration.** | Solid stores visited logical message ID plus offset, not raw scroll height.                                                                             | Return to a conversation restores the same content position after measurement changes.                                                        |
| [x] **R1.17 — Stable prepend.**      | History viewport uses measurements/`ResizeObserver` to compensate prepends.                                                                             | Older-page insertion shifts the visual anchor by less than the provisional 1 px budget.                                                       |
| [x] **R1.18 — Controlled fill.**     | Newer traversal is local-only. The older sentinel may fill a short viewport one page at a time through explicit progress/exhaustion gates.              | Exhaustion stops older reads; an empty/short page cannot trigger uncontrolled draining, and no nonexistent newer network endpoint is implied. |

### Message projection

- [x] **R1.19 — Core content.** Project text, image, reel, post, inline/activity,
      unsupported, and reply-preview rows from normalized domain facts.
- [x] **R1.20 — Semantic and presentation derivation.** Provider/parser code owns
      friendly inbox/unsupported semantic summaries and numeric timestamp
      normalization. Solid derived viewport selectors own localized dates/times,
      sender grouping, and avatar layout without adding worker/cache grouping
      entities. Derive incoming/group avatars and one-to-one peer presentation from
      canonical `isGroup` and participant facts; do not infer Instagram account
      privacy, which the current `User` contract does not expose.
- [x] **R1.21 — Unavailable facts.** Render captured unavailable shares as an
      intentional accessible placeholder, distinct from network failure, with no
      futile fetch loop.
- [x] **R1.22 — Read remains explicit.** Merely opening or scrolling history must
      not mark it read before the durable command stage exists.

Acceptance for R1.19–R1.22: each supported fixture has stable keys and accessible
fallback text; malformed/unsupported content cannot reset the resource; date and
sender grouping remain correct across a prepend boundary.

## R2 — Durable core messaging

R2 is complete by user acceptance following the manual-QA fixes. See
[R2 verification](r2-verification.md) for independent evidence limits (not remaining
acceptance blockers) and the indefinite dedup-tombstone storage tradeoff.

### Outbox and optimistic projection

| Checklist                                     | Lowest owner / implementation                                                                                                                                                                                                                                                                       | Focused acceptance                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x] **R2.1 — Durable acceptance and dedup.**  | Engine transaction persists `(accountId, operationId, immutable payload)`, target, stage, attempts, and outcome before dispatch. Identical redelivery returns the same acceptance; the same ID with a different payload is rejected; distinct user commands remain distinct even when text matches. | Accepted commands survive restart. Storage-quota/write failure rejects acceptance and causes zero provider calls.                                          |
| [x] **R2.2 — Canonical facts plus overlays.** | One pure projector combines canonical server facts with ordered operation overlays. Matching receipts commit facts; failures roll back or retain a failed-send row per operation.                                                                                                                   | Worker and client use the same pure projector for speculation; an accepted revision replaces same-frame speculation without flicker or double application. |
| [x] **R2.3 — Target serialization.**          | Worker serializes commands per target and durably records attempts/unknown outcomes.                                                                                                                                                                                                                | Restart cannot concurrently dispatch the same target; retry eligibility requires explicit operation evidence, not an upstream exactly-once assumption.     |
| [x] **R2.4 — First commands.**                | Closed provider methods implement send/reply, pin/unpin, and paired read marking.                                                                                                                                                                                                                   | Every command has strict input/receipt validation and account/target checks.                                                                               |

### Composer and send lifecycle

- [x] **R2.5 — Local composer state.** Keep per-window, per-thread draft,
      reply intent (edit remains R3), focus, and validation in Solid; handle Enter, Shift+Enter,
      and IME composition correctly.
- [x] **R2.6 — Acceptance semantics.** Clear the submitted draft only when the
      worker accepts the immutable operation; preserve it on rejection.
- [x] **R2.7 — Pending controls.** Show pending/failed messages with eligible
      Retry and Remove. Alias local ID to server ID while preserving stable DOM
      identity.
- [x] **R2.8 — List effects.** Reconcile inbox snippet/order and either follow the
      bottom or preserve the current anchor according to pre-send position.

Acceptance: restart and two-client tests show one durable operation, no duplicate
provider dispatch, stable optimistic content, and no stolen draft from another
window.

### Pins, reads, and incoming repair

- [x] **R2.9 — Authoritative pins.** `PinThreadResult` returns `threadFbid` and
      `isPinned`; validate that target/state against the command account and epoch.
      The worker derives and persists pin order from acceptance order—no upstream
      order field is implied. Never globally reassign pins during account switch. An old
      storage-pin migration is needed only if reintroduced, and must be opt-in for a
      verified account; porting old settings is not required.
- [x] **R2.10 — Paired read mutations.** Target thread `igid`, latest message ID,
      and timestamp together. Maintain a watermark, coalesce the same latest value,
      and prevent a newly arrived message from being rolled back to read.
- [x] **R2.11 — Interest-driven polling fallback.** The worker alone polls known
      inbox/detail queries for visible interested clients, stops with no interests,
      and reconciles facts plus overlays without root reset. Configured initial 5s / capped 60s backoff; production timing measurement remains pending.
      Normal inbox and selected-thread freshness becomes automatic: refresh buttons
      are no longer the primary synchronization UX and remain only as an explicit
      repair/retry affordance when automatic synchronization is delayed or fails.
- [x] **R2.12 — No competing authority.** Do not add independent client polling
      or always-on worker alarms.

Acceptance: two clients plus worker restart converge on the same pin/read/message
state without routine manual refresh; a stale poll response cannot erase overlays
or newer facts. A visible interested client receives incoming inbox/thread changes
automatically, while manual refresh remains available for recovery.

## R3 — Full message interactions

### Reactions and editing

- [ ] **R3.1 — Reaction rail.** Add/change/remove the viewer's reaction with six
      quick choices (default plus five) and accessible state.
- [ ] **R3.2 — Full picker.** Provide categorized, searchable keyboard navigation
      and normalize Unicode/VS16 at the domain boundary.
- [ ] **R3.3 — Strict receipts.** Validate target and reaction arrays/fields;
      test stale server reads against optimistic overlays.
- [ ] **R3.4 — Timed edit.** Edit outgoing text within an inclusive 15-minute
      window, matching IDs and timestamp. Preserve draft/reply on cancel.
- [ ] **R3.5 — Edit reconciliation.** Retry with immutable IDs and retain receipt
      overlay until echo, using an explicit bounded policy (starting proposal:
      three merges or two minutes), never a silent eternal overlay.

### Forwarding

- [ ] **R3.6 — Supported sources.** Forward text, reels, and feed posts to at most
      five loaded targets; disable unsupported attachments with an explanation.
- [ ] **R3.7 — Target chooser.** Restore simple fuzzy filtering over loaded
      targets without a new dependency. When supplied, send and confirm the optional
      comment-before-share as its durable stage before the share stage.
- [ ] **R3.8 — Durable stages.** Give every target/stage an immutable ID; retry
      only incomplete stages after partial failure and never mutate source history.
- [ ] **R3.9 — Feedback.** Report partial completion and errors through global
      toasts/sync status retained across panes.

### Reply navigation

Use opaque older cursors; do not assume an around-message endpoint.

- [ ] **R3.10 — Local-first jump.** Search mounted/cached history first, then
      serially load older opaque cursors through the shared flight until found,
      exhausted, or failed.
- [ ] **R3.11 — Honest progress.** Show page/message counts, not a fabricated
      percentage. A click gets priority and may cancel speculative work.
- [ ] **R3.12 — Focused target.** Install a bounded target window, focus and
      highlight the exact message, and push the prior logical position to a return
      stack.
- [ ] **R3.13 — Return/newest.** Pop exact positions and provide an explicit
      newest control.
- [ ] **R3.14 — Bounded prefetch.** Near-viewport reply previews may queue four
      targets, at most one page each; cancellation and route changes release work.

### Menus, keys, clipboard, and errors

- [ ] **R3.15 — Context menu input.** Support right-click, ContextMenu,
      Shift+F10, and compact 500 ms long-press. Cancel long-press after 10 px movement
      or cancellation and suppress the generated click.
- [ ] **R3.16 — Context menu behavior.** Clamp to viewport, dismiss correctly,
      restore focus, and show no action unsupported by the message/protocol.
- [ ] **R3.17 — Physical shortcuts.** J/K/H/L navigate pane/rows; Ctrl+O returns
      or goes newest even from composer unless a contextual surface/dialog owns
      input; Enter activates a reply-preview target before a share action; Space
      toggles heart.
- [ ] **R3.18 — Shortcut exclusions.** Editors, modifiers, and nested native
      controls suppress shortcuts except the documented Ctrl+O composer behavior.
      Row/pane movement does not paginate or expand the viewport; selecting an inbox
      row may naturally subscribe to/load that thread.
- [ ] **R3.19 — Copy post URL.** Copy the parser-provided canonical target URL and
      announce keyboard-accessible success/failure.
- [ ] **R3.20 — Global feedback.** Toast and synchronization errors survive pane
      transitions and retain actionable failure detail.

Focused R3 acceptance: the same row survives reaction/edit receipts; partial
forward retry never repeats settled stages; a missing reply target shows a
recoverable error; target/return and keyboard movement cause no unintended page
fetch; focus restoration and long-press produce no click-through.

## R4 — Media, player, and engagement

### Media data and loading

- [ ] **R4.1 — Normalize metadata.** Store media, users, comments, and query
      records by IDs; map shortcode-to-media identity. Persist metadata only—never media
      bytes or avatar data URLs.
- [ ] **R4.2 — Closed media protocol.** Use current captured REST media-info and
      shortcode lookup evidence with shared parsers. Components receive domain data,
      never raw document IDs or protocol payloads.
- [ ] **R4.3 — Account/resource retention.** Media facts participate in R1
      references, so inbox/history refresh cannot erase still-used metadata.
- [ ] **R4.4 — Lazy route code and read scheduling.** Load the route chunk on
      intent. The starting budget is 2 concurrent media reads, 2 likely-chat
      warmups, 1 adjacent older-history page, and 4 queued reply targets processed
      serially at one page each. Measure a worker-lifetime/interest budget for
      speculative starts separately from concurrency; never limit visible or explicit
      intent by that budget. Pull chat/history warmups into the R1/R2 read scheduler
      when relevant rather than waiting for the media phase.
- [ ] **R4.5 — Stable previews.** Reserve actual-aspect geometry up to a
      300×300 preview; inline previews never autoplay. Retain thumbnails until playable content is
      ready rather than flashing blank.
- [ ] **R4.6 — Safe avatars.** Reintroduce fetch/proxy support only when needed,
      with HTTPS, 2 MiB maximum, no redirects, exact CDN permission, and disposable
      object/data URLs that are never persisted.
- [ ] **R4.7 — Intentional unavailable card.** Give unavailable shares accessible
      retained metadata and no repeated fetch.
- [ ] **R4.8 — Media-forward history card.** Restore compact author, borderless
      media, external reaction, and time-on-hover behavior.

### Modal and custom player

- [ ] **R4.9 — Accessible modal.** Trap/restore focus, inert the background, lock
      scroll, close outside/on Escape, and use aspect-aware desktop presentation plus
      a compact full-screen sheet.
- [ ] **R4.10 — Player basics.** An explicitly opened new modal item may begin
      playback when the browser permits; an item explicitly paused earlier remains
      paused. Support play/pause, blocked-playback reporting, seek, time, and
      fullscreen with native media semantics.
- [ ] **R4.11 — Variant quality.** Switching quality preserves current time,
      playback rate, volume/mute, and play intent.
- [ ] **R4.12 — Carousel isolation.** Keep independent per-item state; forced
      muting of a slide video must not overwrite the user's global preference.
- [ ] **R4.13 — Player gestures/keys.** Distinguish Space/tap from a 250 ms 2×
      hold with cleanup; support comma/period one-frame stepping (1/30 fallback) and
      arrows without leaking into global shortcuts.
- [ ] **R4.14 — Controls visibility.** Keep controls visible with focus; otherwise
      treat an initial 10 s idle / 1.5 s pointer-leave policy as a
      starting point, not a measured SLA.
- [ ] **R4.15 — State authority.** Playback position/paused state is per window.
      Global volume/mute uses one `storage.local` service and only adds permission
      when that persistence ships.
- [ ] **R4.16 — Attached audio/music.** Render title/artist/offsets; keep the
      soundtrack across slides, pause it on close, force slide-video mute without
      changing user preference, and report blocked playback.
- [ ] **R4.17 — Signed URL refresh.** Keep modal/metadata mounted while the worker
      performs one forced shared refresh; show explicit Retry on failure.
- [ ] **R4.18 — Safe export.** Carry the parser-provided `targetUrl` in the open
      intent for Copy. Download only when actual parser fields establish signed-CDN
      URL eligibility. Never invent a `shareURL` contract or download endpoint.

### Comments and engagement

- [ ] **R4.19 — Lazy comments.** Start only after modal open/media ready. Preserve
      exact top-level and child cursors and explicit server pagination.
- [ ] **R4.20 — Comment budget.** Choose and test a mounted-comment budget before
      shipping; do not assume the history 80-row limit applies to comments.
- [ ] **R4.21 — Like/save/comment reactions.** Route media like/save and comment
      like/unlike through the durable outbox with strict receipt identity.
- [ ] **R4.22 — Create/reply comments.** Enforce the 2200-character limit and
      persist every accepted intent. Known success reconciles receipt, entity, and
      parent. Because there is no proven reliable client key for this non-idempotent
      action, mark only lost/uncertain outcomes `outcome_unknown` and never blindly
      replay them.
- [ ] **R4.23 — Social cue integrity.** Show at most five named likers only with
      proof they are viewer-followed; optional ranked-comment same-author cues are
      allowed. Never infer arbitrary “friends.”

Acceptance for R4 includes geometry, cleanup race, optimistic rollback, and
account/resource-scope tests in addition to parser fixtures.

## R5 — Unfinished backlog and preferences

Motion settings may ship in this phase, but accessibility does not wait for R5:
every animation restored earlier must already honor system reduced-motion and
must not animate placement/layout. Likewise, pull the single settings service
forward when the first persistent setting ships rather than creating a temporary
authority.

### Motion

- [ ] **R5.1 — Explicit global preference.** Offer System, Reduced, and Full in a
      single settings authority; subscribe to live OS changes.
- [ ] **R5.2 — Gate before mount.** Resolve the preference before mounting every
      transition/spinner. Motion choices do not alter network policy or autoplay.
- [ ] **R5.3 — Safe motion scope.** Never animate row position, layout, or history
      anchor maintenance. Animate only a newly accepted tail entry, not cached or
      prepended rows.
- [ ] **R5.4 — Lifecycle/focus.** Add retained exits only for concrete surfaces;
      Reduced removes timers and restores focus immediately. Test reopening during
      close. Do not copy Teact mechanisms or add a generic animation framework.

### Preferences and protocol diagnostics

- [ ] **R5.5 — Wheel controls need opt-in.** Volume/speed wheel behavior remains a
      proposal until it has a discoverable opt-in or explicit control target that
      cannot hijack page scroll. Clamp values and test mouse, trackpad, and keyboard
      alternative; do not invent an arbitrary gesture.
- [ ] **R5.6 — Passive descriptor monitor.** A MAIN-world observer may record
      GraphQL operation names, document IDs, endpoint, and timestamp only—never
      tokens or message text, and never auto-update protocol values.
- [ ] **R5.7 — Narrow stale-operation errors.** Diagnose a captured stale
      operation/error taxonomy without scraping provider internals in UI.
- [ ] **R5.8 — Iris/MQTT evidence gate.** Require a fresh authenticated capture
      and two-account manual validation. Observe Instagram's own client; do not build
      a new raw MQTT client. Polling remains the one repair authority and must not be
      duplicated. `qq3b` therefore remains a gap.
- [ ] **R5.9 — Optional offline partition.** Current cached UI does not
      authenticate an unknown offline account. Any later offline choice must be
      explicitly labeled read-only and include export, clear, retention, and privacy
      decisions rather than silently falling back.
- [ ] **R5.10 — Settings ownership.** Keep small global preferences in one
      `storage.local` service with cross-client broadcasts; account settings remain
      separate. Add permissions only with the consuming feature.
- [ ] **R5.11 — Friendly-state audit.** Recheck friendly unsupported and
      unavailable copy against fresh fixtures; its rendering foundation belongs to
      R1, while broad copy review remains unfinished.

## R6 — Optional extensions, not restoration commitments

These require separate product and protocol decisions. They must not appear as
working controls, empty navigation destinations, or capability adapters merely
because parsers/types exist.

- [ ] **R6.1 — Watch history (optional).** Define meaningful playback sessions,
      coalescing, retention, privacy, and Clear before recording anything.
- [ ] **R6.2 — Engagement event history (optional).** Local operation events for
      likes/saves may be recorded with retention, but cannot claim to reconstruct
      complete Instagram history.
- [ ] **R6.3 — Route rail (optional).** Add a rail only after multiple real
      destinations ship; no empty placeholders.
- [ ] **R6.4 — Protocol-only inbox features (new scope).** Requests/Spam folders,
      unread counts, richer thread info/message actions, message pinning, cutout
      stickers, composer trays, emoji/stickers/music/avatar, automatic-preview
      settings, and richer sends require fresh API proof before commands are added.
- [ ] **R6.5 — Unevidenced communication features (new scope).** Typing, online
      status, remote-seen indicators, attachments/upload, deletion/unsend, search,
      conversation mute, and new-conversation creation were not formerly shipped
      core behavior. Treat each as an evidence gap, not restoration.
- [ ] **R6.6 — Shell redesigns (optional).** Foldable sidebar and a generic
      settings page need current product decisions; do not blindly revive scrapped
      Svelte structures.

## Quality gate for every slice

- [ ] Run `bun run test`, `bun run check`, `bun run lint`, `bun run build`,
      `git diff --check`, and the repository shared `ast-grep` scan.
- [ ] Split tests by feature/owner and cover behavioral requirements through
      current contracts; do not restore a retired harness or one giant suite.
- [ ] Cover offline unknown-identity recovery, account changes, epoch/sequence
      gaps, duplicate/irrelevant commits, and snapshot races as multi-resource state
      is introduced.
- [ ] Prove memory, DB, and outbox bounds/eviction and that no network request is
      held inside a database transaction.
- [ ] Keep real installed-browser/live-account release evidence separate from
      mocked provider/browser tests.
- [ ] Enforce **hard mount invariants** of at most 31 inbox rows and 80 history
      rows. Use 1,000 normalized IDs as a test fixture size, not a snapshot
      cardinality requirement. Keep merge/window work below a provisional 50 ms
      maximum main-thread task; this is not a new input-response SLA.
- [ ] Treat p95 100 ms warm navigation and p95 300 ms authorized retained-cold
      navigation as provisional targets. Same-frame speculative feedback is distinct
      from durable worker acceptance/acknowledgement and must be measured separately.
- [ ] Measure end-to-end navigation from input/UI entry to visible content; do
      not start the stopwatch after identity or chunk readiness. Record readiness and
      account status, separate eligible warm/authorized-cold cases from absent
      identity/missing cache, and report those gate costs rather than hiding them.
      Identify fixture, browser, hardware, and cache state.
- [ ] Record the current clean bundle before the relevant slice and target no
      more than +15 KiB gzip for the incremental feature proposal. Revisit and agree
      the budget before a large restored scope rather than applying 15 KiB to all
      restoration. Never claim a performance win from comparing against a retired
      bundle that contained more features.
