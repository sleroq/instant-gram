# Frontend architecture

**Status:** R2 complete by user acceptance following the manual-QA fixes. The
[application architecture contract](application-architecture.md) defines ownership;
the [restoration checklist](solid-restoration-checklist.md) and milestone beans
track completion. Acceptance and independent evidence limits are recorded in
[R2 verification](r2-verification.md); [R1 evidence](r1-verification.md) is historical.

`entrypoints/ui/index.html` remains the sole production `/ui.html` page. Solid
renders worker-owned normalized dictionaries and resource projections; it does
not own canonical merges, provider requests, cursors, persistence, or polling.

| Owner                                   | Responsibility                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `App.tsx`                               | Compose route, client, inbox and conversation; clear window state on identity reset        |
| `client.ts`                             | One Port, complete projection reconciliation, epoch/sequence recovery, closed read and command intents |
| `route.ts`                              | Per-window `#/` and `#/thread/<stable-key>` routes and browser history                     |
| `InboxList.tsx`, `virtual-list.ts`      | Fixed 72px rows, at most 31 mounted, logical list position and selection focus             |
| `Sidebar.tsx`                           | Window-local accessible desktop resizing; no persistence authority                         |
| `ConversationPane.tsx`, history helpers | Bounded local windows, logical ID-plus-offset anchors, controlled older reads              |
| `MessageRow.tsx`                        | Domain-only text, image/share/reply/activity/fallback presentation and localized dates     |

Desktop shows inbox and conversation panes; compact screens mount the routed
pane and restore inbox position/focus on Back. Resizing is local to the window
until the single settings service exists. The shell is dark and minimal, with
no navigation rail or empty feature destinations. System reduced-motion is
honored; row placement and anchor corrections are not animated.

History starts with a 40-message window and mounts at most 80 rows. Movement
consumes retained IDs before requesting an older page. Newer traversal is local
only; the provider has no newer-page UI capability. Retry and continuation are
domain intents—the worker chooses their opaque cursors. Cached content remains
visible during refresh or errors. IndexedDB retains complete loaded history;
400-ID client windows and the 80-row DOM bound are independent of durable
retention. Under account storage pressure, the worker evicts whole inactive
histories while protecting interested and recent histories.

## R2 command and synchronization ownership

`Composer.tsx` owns per-window, per-thread drafts and reply intent, input validation,
Enter/Shift+Enter and IME behavior. Drafts clear on durable worker acceptance,
not on provider dispatch, and remain on rejection. The shared pure projector
combines canonical facts with ordered speculative/durable overlays. Pending rows
expose queued, dispatching, failed, and unknown outcomes with only eligible Retry
and Remove controls. Unknown sends are never blindly retried.

The worker owns send/reply, pin/unpin, paired read commands, serialization,
settlement, and visible-interest polling. Read marking targets only the latest
message actually seen, not simply the opened thread or a newly arrived message.
Snapshots include bounded operations (200 active commands plus 200 settled send
aliases). Retained alias-to-canonical logical anchors resolve in the worker;
clients do not build a second canonical alias store.

Polling starts at a configured 5 seconds and backs off to a 60-second cap; these
are policy targets, not production-measured freshness. No visible interests means
no polling. Refresh remains a repair/retry affordance, not routine synchronization.
Images and share/reply previews remain message previews, not media playback.
R3 reactions/edit/forward, R4 media/player/comments, and R5 settings remain future.
See [R2 verification](r2-verification.md) for persistence tradeoffs and independent evidence limits.
