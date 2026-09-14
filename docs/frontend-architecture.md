# Frontend architecture

**Status:** R1 read-only restoration slice. The
[application architecture contract](application-architecture.md) defines ownership;
the [restoration checklist](solid-restoration-checklist.md) and milestone beans
track completion. Verification and remaining release gates are recorded in
[R1 verification](r1-verification.md).

`entrypoints/ui/index.html` remains the sole production `/ui.html` page. Solid
renders worker-owned normalized dictionaries and resource projections; it does
not own canonical merges, provider requests, cursors, persistence, or polling.

| Owner                                   | Responsibility                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `App.tsx`                               | Compose route, client, inbox and conversation; clear window state on identity reset        |
| `client.ts`                             | One Port, complete projection reconciliation, epoch/sequence recovery, closed read intents |
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
visible during refresh or errors. The current local retention limit is
transitional and is not presented as the end of the Instagram conversation.
Removing that durable limit does not enlarge Solid's interest-scoped projection
or 80-row DOM window.

Images and share/reply previews are read-only message content. Share links open
their external targets; no modal player, media-info fetching, comments, composer,
pin/read/reaction/edit/send command, or automatic incoming polling is implied.
Merely opening history never marks it read. These capabilities belong to later
restoration milestones, not adapters around the remaining protocol modules.

The visible Refresh controls are transitional R1 synchronization UX. R2.11 must
make inbox and selected-conversation freshness automatic for interested visible
clients; manual refresh may remain as recovery, but must not be required for
ordinary incoming-message updates.
