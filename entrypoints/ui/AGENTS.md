# Solid Messages client

Read [application architecture](../../docs/application-architecture.md) and the
[Solid 2 guide](../../docs/solid-2-guide.md). This is the sole production
`/ui.html` client. Future scope belongs in [the roadmap](../../docs/roadmap.md).

## Ownership and modules

- `App.tsx` composes features and owns per-thread drafts, reply intent, and
  acceptance guards for this window. Clear these on identity reset.
  `route.ts` owns `#/` and `#/thread/<stable-key>` browser history.
- `client.ts` owns one Port, complete bounded projection reconciliation,
  epoch/sequence recovery, and closed command/read intents. Reconnect or gaps
  request snapshots; no UI-owned canonical cache, alias store, provider RPC,
  persistence, polling, retry scheduler, or cursor selection.
- `InboxList.tsx`/`virtual-list.ts` own list position and selection focus;
  `ConversationPane.tsx`/history helpers own local windows and logical anchors.
- `Composer.tsx` edits the supplied draft and handles validation, Enter/Shift+Enter,
  and IME. Clear only the accepted draft version after durable worker acceptance;
  preserve newer edits and rejected drafts.
- `MessageRow.tsx` renders domain-only text/image/share/reply/activity/fallback
  values and localized dates. Previews do not imply media playback.
- `Sidebar.tsx` resizing is window-local; do not add persistence authority.

## Projection and reactivity

Use `createStore` for normalized dictionaries, draft setters/`reconcile` for
updates, signals for primitive window state, and memos for derived values.
Iterate stable ID arrays with `<For>` and select entities by ID. Keep props
intact; do not mirror derived state with effects or fetch through async memos.
Separate tracked computation from imperative effect application. Dispose Ports,
DOM listeners, observers, and media resources with their Solid owner.

The shared pure projector combines canonical facts and ordered speculative or
durable overlays. Pending rows expose queued, dispatching, failed, and unknown
outcomes with only eligible Retry/Remove controls. Unknown sends are never
blindly retried. Let the worker resolve retained send aliases to logical anchors.
Only mark the latest message actually seen read; opening or fetching is not
seeing, and arrivals do not advance the seen watermark automatically.

## Bounded rendering and navigation

- Inbox rows remain fixed at 72px, with at most 31 mounted rows.
- History starts at 40 messages and mounts at most 80 rows. Consume retained IDs
  before requesting older history; newer traversal is local. The worker's
  400-ID projection window is not a DOM or durable-retention limit.
- Preserve ID-plus-offset anchors after prepend and measured size changes.
  Maintenance scroll corrections are immediate, not animated.
- Respect previous proven coverage and `newerCoverageAvailable`; current newest
  adoption is explicit. Never concatenate detached ranges or jump an older reader.
- Keep cached content visible during refresh/errors. Refresh and failure-specific
  Retry are domain intents; the worker selects opaque cursors.
- Desktop uses inbox/conversation panes; compact screens mount the routed pane.
  Back restores inbox position and focus, not merely CSS visibility.
- Honor system reduced-motion. Do not animate layout, virtual-slot placement or
  anchor corrections. Approved `icr-f00w` may physically slide already-mounted
  sidebar conversations through a separate presentation transform during reorders;
  fixed 72px slots, the 31-row bound, stable keys and logical focus/anchors remain
  unchanged. Reduced makes the reorder immediate. See [motion](../../docs/motion.md).
  Expose only currently implemented capabilities.

Keep protocol knowledge outside components and source/styles/assets
repository-owned. Test bounded DOM, identity retention, keyboard/accessibility,
focus, anchors, responsive routes, and same-frame command feedback. Mocked-Port
checks do not substitute for installed-extension/live-account evidence.
