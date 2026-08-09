---
# icr-qq3b
title: Synchronize incoming Instagram DM updates
status: in-progress
type: task
priority: high
tags:
    - discovered
    - dm
    - realtime
created_at: 2026-08-06T14:50:22Z
updated_at: 2026-08-09T12:00:00Z
---

Incoming updates are not implemented: the UI store loads the inbox only at startup/pagination/retry, the anchor exposes only request/response RPC, and no Iris/MQTT/page-context listener or refresh loop exists. The completed DM-mutations milestone also explicitly excludes incoming live updates.

Implement reliable incoming-DM synchronization so messages, reactions, and inbox activity caused by another user reach and reconcile on the extension client. First validate the currently available Instagram page transport with a live authenticated session and fresh captures; the existing HAR documents Iris/MQTT intent but has no decoded WebSocket frames. Prefer a passive page-context observer of Instagram's own live thread updates. Use bounded polling of the selected thread/inbox only as the fallback if that observer cannot provide a stable, safe event contract. Do not create a second entity cache or put Instagram protocol knowledge in UI components.

Checklist:

- [ ] Capture and document the actual event/update shape and lifecycle from Instagram's own Iris/MQTT/page runtime, including reconnect/auth/tab lifecycle; redact credentials and message content from diagnostics/fixtures.
- [x] Define a narrow typed update boundary from page/anchor through background to the UI store; retain the closed-capability routing model.
- [x] Reconcile incoming thread/message/reaction updates into the existing normalized inbox and per-thread histories, deduplicated by stable server message ID and ordered by timestamp without regressing optimistic local sends or newer mutation receipts.
- [x] Update inbox snippets/activity/order while preserving explicit pin order. For an open thread, merge new messages without resetting the bounded 40–80 row window or displacing an older-reading scroll anchor; follow only when already at bottom and otherwise expose/maintain a new-message route.
- [x] Handle relevant non-message updates proven by capture (at minimum reaction changes); leave typing/read receipts/unsupported update classes explicitly out of scope unless their data contract is captured.
- [x] Make listener/polling lifecycle single-flight, generation-safe, and fully disposable across anchor/UI teardown, reconnects, and stale completions. Polling, if used, must be visibility-aware and have an explicit interval/backoff/error policy.
- [x] Add focused protocol/store tests for duplicate, out-of-order, stale, and optimistic-send reconciliation; add a browser regression for open-thread bottom versus scrolled-up behavior.
- [ ] Run npm test, npm run check, npm run build, and git diff --check; perform a manual two-account verification that an incoming message and reaction appear without user refresh.

Acceptance criteria:

- Another participant's new message updates the inbox and an open conversation without manual reload or pagination.
- Updates are idempotent and cannot duplicate rows, overwrite pending/confirmed local sends, or break normalized ordering/pins.
- Rendering stays bounded and preserves the reader's anchor unless they were following the newest messages.
- Transport remains credential-safe, typed, and isolated outside UI components.



## Implementation handoff (high-confidence repository fit)

The current tree has no inbound transport: `entrypoints/ui/store.ts` calls `loadInbox()` only from `start`, pagination, and retry; `entrypoints/ig-anchor.content.ts` registers request/response RPC handlers only; and `entrypoints/background.ts` only routes UI-initiated RPC. This task is therefore new capability work, not a small bug fix.

### Recommended delivery order

1. **Capture first; do not independently implement Iris/MQTT.** `docs/instagram-live-communication.md` confirms that Instagram uses Iris/MQTT but explicitly says the available HAR lacks decoded WebSocket frames. With two authenticated accounts, instrument the Instagram page to identify a stable, passive signal from Instagram's own live client (internal callback/store signal preferred; a `WebSocket` message observer only if necessary). Record only redacted structural fixtures and lifecycle observations.
2. **Reuse the existing page-world bridge pattern.** `entrypoints/ig-auth-probe.content.ts` already runs in `world: 'MAIN'`, and `lib/ig-auth.ts` bridges its data through a named `CustomEvent` to the isolated anchor. Add an adjacent MAIN-world live observer which emits only a JSON-safe, minimal update payload on a distinct event; have `ig-anchor.content.ts` validate and consume it. Do not expose raw frames, page objects, tokens, cookies, or arbitrary page messages.
3. **Add a narrow shared update contract.** Define a discriminated inbound-DM update type in `lib/domain.ts`; normalize/validate Instagram payloads in the anchor/API parser layer, never in `App.tsx` or other UI components. Cover only captured variants—expected candidates are thread metadata/snippet, new message, and authoritative reaction state.
4. **Relay unsolicited updates through the extension boundary.** Extend the existing background/bridge boundary with an explicit anchor-to-background-to-UI event route rather than treating incoming updates as RPC responses. The implementing agent should choose the supported `webext-bridge` or browser runtime event primitive after verifying its extension-page lifecycle semantics. UI listener setup/teardown belongs in `store.start()` / `destroy()`; background must not retain stale UI listeners.
5. **Reconcile in one new store action, e.g. `applyIncomingUpdate`.** It must update existing normalized `inbox.byId`/`orderedIds` and, only for an already loaded history, `HistoryState.byId`/`listedIds`/`viewportIds`. Deduplicate messages by server ID; use timestamps/revisions so an out-of-order event cannot regress newer inbox state, a confirmed optimistic send, or a newer reaction mutation receipt. Preserve `rowKeyByMessageId` when an incoming server entity races local-send reconciliation.
6. **Respect established rendering invariants.** Preserve explicit `pinnedIds` while moving unpinned active threads. Do not reset a history or create an unloaded history cache. For an open history, append/follow only if the view was already at newest; otherwise leave its 40–80 row viewport and scroll anchor intact and retain/provide a route to newest.
7. **Use polling only as fallback.** If passive observation cannot yield a stable safe event contract, create a single-flight, visibility-aware, generation-safe selected-thread/inbox refresh loop with explicit interval/backoff and full teardown. Existing documented history pagination is older-only, so first capture/prove a newer-message query or use a safe full-detail refresh; do not assume the older cursor query can retrieve incoming tails. Feed fallback results through the same reconciliation action.

### Important boundaries

- `lib/domain.ts` owns typed shared entities/events; `entrypoints/ui/store.ts` owns synchronization lifecycle, merge policy, cursor/single-flight/generation rules; components own only bottom-position measurement and presentation.
- Keep Instagram protocol parsing outside UI; keep the current normalized entity model and bounded history window.
- Do not add a second cache, a generic event framework, raw MQTT client, typing indicators, or read-receipt behavior unless an exact captured contract makes a separate scope justified.
- An update received while the UI is closed may be dropped in this first slice; the ordinary authoritative inbox load at next UI startup remains the recovery path. Durable background persistence is not required unless live validation exposes a user-visible gap.

### Minimum focused regression matrix

- duplicate and out-of-order incoming messages are idempotent;
- an inbound server copy racing an optimistic local send leaves one stable keyed row;
- an inbound reaction cannot overwrite a newer in-flight local reaction;
- unpinned inbox activity reorders without changing explicit pin order;
- open-chat at-bottom follows incoming message, while scrolled-up retains anchor and bounded viewport;
- stale events after UI/anchor teardown are ignored;
- two-account manual check proves an incoming message and reaction appear without UI reload.



## Implementation result (2026-08-09)

Implemented the documented polling fallback because no authenticated two-account session or decoded Iris/MQTT event contract was available. The visible UI polls the proven initial inbox and selected-thread newest-detail queries every 5 seconds, backs off to 60 seconds, and feeds normalized entities through one typed `IncomingDmSnapshot` reconciliation boundary. Lifecycle is single-flight, visibility-aware, generation-gated, and fully disposed. Store and browser coverage protects deduplication/order, pins, optimistic send row identity, reaction receipt races, bounded follow versus anchor preservation, backoff, visibility, and teardown.

Verification: `npm run check`, `npm run build`, `git diff --check`, focused store tests, and the focused incoming browser regression pass. Full `npm test` passes 157/158; the unrelated pre-existing `extreme finite reel ratios keep both production media axes renderable` browser test fails at `history.browser.test.ts:684` against pre-existing reel work. Iris/MQTT capture and manual two-account validation were not performed and remain intentionally unchecked.



## Independent review remediation (2026-08-09)

Polling now shares the inbox read flight and per-thread history read ownership with initial/pagination/older loads, suppresses selected-thread detail during sends, and discards a detail response when a send starts after the read. Reaction revisions protect peer/local updates from stale polling and older-page completions; the snapshot boundary is inert after teardown. Focused coverage includes cross-path races, unresolved optimistic-send duplication, peer/stale reactions, older-page reaction races, two-pinned/two-unpinned ordering, the 60-second backoff cap, and teardown. Implementation under the polling fallback is complete, but the task remains in progress because authenticated two-account freshness and manual message/reaction validation were not performed.

## Second review remediation (2026-08-09)

Consumed poll timers and visibility resumes that collide with initial inbox or pagination ownership now install one bounded replacement timer with the current backoff, so ordinary reads cannot silently stop synchronization. Reaction reconciliation accepts authoritative empty and timestamp-less arrays, rejects stale overlapping completions by captured revisions, keeps pending viewer removals absent, and refreshes their failure rollback baseline. Reselecting a history invalidates its old bottom-follow measurement before emission, preserving a restored older viewport until the current pane reports geometry. Focused timer/reaction/selection store regressions and the focused existing incoming-follow browser regressions pass. `npm run check`, `npm run build`, and `git diff --check` pass. Full `npm test` passes 161/162; the same unrelated pre-existing `extreme finite reel ratios keep both production media axes renderable` browser assertion fails at `history.browser.test.ts:684`. Authenticated capture, live freshness, and manual two-account message/reaction validation remain unavailable and intentionally unchecked; the bean stays in progress.

## Final review blocker remediation (2026-08-09)

The retained `MessagePane` now acknowledges incoming-follow versions by thread ID and version, baselines each destination thread during its selection layout transition without scrolling, and ignores stale follow measurements for unselected threads. A production-App browser regression preserves thread B's row anchor and non-bottom geometry after thread A follows an incoming message, then proves a fresh bottom measurement lets B follow its next incoming message. The regression was also run against the former scalar acknowledgement and failed at the restored-anchor DOM assertion as intended. Focused browser/store tests, `npm run check`, `npm run build`, and `git diff --check` pass. Full `npm test` passes 162/163; only the known unrelated extreme-reel-ratio browser assertion at `history.browser.test.ts:684` fails. The bean remains in progress, and authenticated two-account validation remains unchecked.
