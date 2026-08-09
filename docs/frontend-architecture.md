# Frontend architecture and state

This is the source-of-truth map for the current extension UI and its message
history implementation. Read it with [`teact-guide.md`](./teact-guide.md) before
frontend changes.

## Ownership map

| Source | Owns | Must not own |
| --- | --- | --- |
| [`lib/domain.ts`](../lib/domain.ts) | Shared background/UI entities, result envelopes, and RPC signatures | UI state, network implementation, DOM details |
| [`entrypoints/ui/main.tsx`](../entrypoints/ui/main.tsx) | One app store, Teact root mount, global SCSS entry | Feature state or Instagram requests |
| [`entrypoints/ui/rpc.ts`](../entrypoints/ui/rpc.ts) | Typed `webext-bridge` UI-to-background calls | Cursor policy, state merging, rendering |
| [`entrypoints/ui/store.ts`](../entrypoints/ui/store.ts) | Normalization, bounded history IDs, async actions, retries, generations, selection, pin ordering, warmups | DOM measurement or presentation |
| [`entrypoints/ui/virtual-list.ts`](../entrypoints/ui/virtual-list.ts) | Pure fixed-row inbox window calculation | History geometry or fetching |
| [`entrypoints/ui/history-window.ts`](../entrypoints/ui/history-window.ts) | Pure 40/80 history-window calculations | Fetching or DOM measurement |
| [`entrypoints/ui/App.tsx`](../entrypoints/ui/App.tsx) | Shell and sidebar-resize interaction, inbox DOM, bounded message pane, anchor measurement, store subscription | Instagram protocol details or a second cache |
| [`entrypoints/ui/sidebar-resize.ts`](../entrypoints/ui/sidebar-resize.ts) | Pure sidebar width bounds and persisted-value parsing | DOM events or entity state |
| [`entrypoints/ui/styles.scss`](../entrypoints/ui/styles.scss) | Tokens, layout, presentation, motion/reduced-motion | Data-dependent decisions |
| [`vendor/teact`](../vendor/teact) | Pinned MIT runtime | Telegram application code |

The background routes RPC to the Instagram content-script anchor and owns pin
persistence. Instagram request/query details remain outside UI code. See
[`instagram-methods.md`](./instagram-methods.md),
[`instagram-live-communication.md`](./instagram-live-communication.md), and
[`instagram-har-useful-requests.md`](./instagram-har-useful-requests.md). Browser
captures are under [`docs/examples`](./examples); they may contain real request
shapes and should be treated as reference evidence, not copied into components.

## Authoritative domain and RPC boundary

`lib/domain.ts` defines:

```ts
getInbox({ cursor? }): Result<Page<Thread>>
getThread({ threadKey, cursor? }): Result<ThreadMessages>
getReelMedia({ shortcode, mediaId? }): Result<ReelMedia>
getReelComments({ mediaId, cursor? }): Result<ReelComments>
setReelLiked({ mediaId, liked }): Result<ReelLikeReceipt>
setReelSaved({ mediaId, saved }): Result<ReelSaveReceipt>
getPins(): { pinned: string[] }
togglePin({ threadKey, threadFbid, pin }): Result<{ pinned, receipt }>
sendText({ threadFbid, text, replyToMessageId?, offlineThreadingId }): Result<SentTextMessage>
setReaction({ threadFbid, messageId, emoji }): Result<SetReactionResult>
forwardMessage({ targetThreadFbid, sourceThreadIgId, sourceIsViewer, offlineThreadingId, content }): Result<SentMessage>
```

`CompleteUiRpc` mechanically maps those signatures to promises. The read-only
`UiRpc` subset keeps read dependencies narrow; the frontend store additionally
requires only `sendText` and `setReaction`. `rpc.ts` sends each message to
`background`; it does not interpret results. Keep the discriminated `Result<T>`
check in actions at the store boundary.

The extension bridge is a closed capability list. DM and reel mutation RPCs
above are routed through UI, background, and content script; the broader
Instagram operation catalog (including generic GraphQL execution, read markers,
message pins, and richer sends) is not exposed to UI code. The content-script
anchor executes catalog descriptors and converts thrown request/decoder errors
to `Result` failures. Text success requires both server message ID and timestamp;
reaction success requires the matching target ID and the complete authoritative
reaction array. Document IDs and exact request variables remain solely in
`lib/config.ts` and `lib/instagram-api/catalog.ts`.

Message forwarding is one store-owned modal intent over normalized inbox and
history entities. It never selects or loads a target history. Up to five loaded
threads with an operation identifier can be selected; UI fuzzy
filtering only ranks those normalized entities. For each target, the store sends
an optional non-whitespace comment through the ordinary text RPC and awaits its
receipt before issuing the content-specific forward request. Per-target progress
stores a stable offline threading ID for each stage and records whether that
stage completed, so retry resumes incomplete work without duplicating requests
whose server response was lost. Source content and protocol metadata, target
operation IDs, and the optional comment become immutable once their associated
request IDs are allocated, keeping every retried payload idempotent.
The whole operation is single-flight and generation-guarded. Success is announced
inside the focus-contained modal; partial failures retain their selected targets
and actionable retry state without changing `selectedThreadId` or target caches.
The currently captured forward protocol covers text and reel-share messages
with a numeric media ID; unsupported message content does not expose Forward.

Cursor names are easy to confuse:

- `Thread.key` is the stable normalized UI identity.
- `Thread.cursor`, when present, is Instagram's request key for that thread.
  Initial and older history calls use `thread.cursor ?? thread.key` as
  `threadKey`.
- `HistoryState.cursor` is the page cursor returned by `getThread`; Milestone 1
  stores it but does not request it. Milestone 2 older calls pass it as the
  payload's separate `cursor` field.
- `InboxState.cursor` is the next inbox page cursor. `loadNextInboxPage` may use
  it only when `hasNextPage` is true and that cursor is not failure-gated.

Instagram history pages contain up to 20 messages and parsing presents each
page oldest-to-newest. The API exposes older pagination only. “Newer” movement
means moving through local loaded IDs. Pagination may omit
`ThreadMessages.thread`; merge messages by `message.id`, not response object
identity. `viewerId` determines outgoing presentation. Keep the viewer identity
established by initial thread detail: older-page responses can lack the thread
viewer and therefore carry the weaker authenticated-user fallback instead of
the interoperable sender ID used by messages.

## Current state: Milestones 1–3

The exact implemented structure in `store.ts` is:

```ts
type Status = 'idle' | 'loading' | 'ready' | 'error';

type InboxState = {
    orderedIds: string[];
    byId: Record<string, Thread>;
    cursor?: string;
    hasNextPage: boolean;
    status: Status;
    isLoadingMore: boolean;
    error?: string;
    failedCursor?: string;
};

type HistoryState = {
    byId: Record<string, Message>;
    listedIds: string[];
    viewportIds: string[];
    cursor?: string;
    hasOlder: boolean;
    viewerId?: string;
    status: Status;
    isPreloading: boolean;
    isLoadingOlder: boolean;
    isPreloadingOlder: boolean;
    isReplacingViewport: boolean;
    failedOlderCursor?: string;
    scrollAnchor?: { id: string; offset: number };
    draft: string;
    replyTargetId?: string;
    replyNavigation?: {
        requestId: number;
        targetId: string;
        returnId?: string;
        status: 'loading' | 'ready' | 'error';
        pagesLoaded?: number;
        messagesLoaded?: number;
        isPositioned?: boolean;
        error?: string;
    };
    replyReturnStack: string[];
    pendingSends: Record<string, PendingSend>;
    failedSends: Record<string, FailedSend>;
    rowKeyByMessageId: Record<string, string>;
    reactionMutations: Record<string, ReactionMutation>;
    isFollowingNewest: boolean;
    incomingFollowVersion: number;
    error?: string;
};

type FrontendState = {
    inbox: InboxState;
    pinnedIds: string[];
    committedPinnedIds: string[];
    pinsStatus: Status;
    pinMutations: Record<string, {
        pin: boolean;
        order: number;
        status: 'pending' | 'error';
        error?: string;
    }>;
    selectedThreadId?: string;
    histories: Record<string, HistoryState>;
    reels: { activeId?: string; activeUrl?: string; byId: Record<string, ReelState> };
};
```

The implementation adds `isReplacingViewport` to the plan's state sketch so DOM
replacement and sentinel triggering cannot overlap. Drafts, reply targets, send
delivery state, stable row-key bridges, and reaction flights are per history;
components do not maintain parallel mutation caches.

### Normalization and ordering

`inbox.orderedIds` records first-seen server order. `inbox.byId` holds the latest
thread object per `thread.key`. `mergeThreads` appends only unseen keys but
replaces the entity for every received item. Therefore overlapping pages update
metadata without duplicating rows.

Histories use the same separation: `listedIds` is all contiguous loaded IDs in
chronological order, `viewportIds` is the bounded 40–80 ID DOM window, and
`byId` is message lookup. Older pages prepend only unseen IDs and replace every
received entity, so overlaps update content without duplicating rows.

Accepted outgoing sends append one optimistic `local:<offlineThreadingId>` entity
to `byId`/`listedIds`. They append to `viewportIds` only when the component's
immediate pre-dispatch bottom measurement permits following newest; otherwise
the bounded viewport and logical anchor remain unchanged. Reconciliation replaces
the local ID with the server ID in every normalized index, removes any duplicate
server ID already received, and records the local ID under the server ID in
`rowKeyByMessageId`. `MessageRow` uses that bridge as its domain key, so the
optimistic DOM row survives ID reconciliation. The viewport remains capped at 80.

Components must iterate ordered IDs and look up entities. Do not duplicate
thread/message objects into pinned, selected, or viewport arrays.

### Shared reel/post cache and open intent

The legacy-named reel cache is the shared modal-media cache for both `/reel/`
and `/p/` DM shares. The message parser records an explicit media type, while
the REST info parser independently derives reel versus feed-post presentation
from `product_type`; UI components do not interpret Instagram URLs or response
fields. Both media types use `shortcode` as the stable normalized key. Each
`ReelState` holds one
`ReelMedia` entity plus normalized comment `listedIds`/`byId`, independent media
and comment status/error state, and visible like/save mutation state. Media IDs
remain operation identifiers and do not replace the stable shortcode key.
`ReelMedia.items` represents one video/image or every ordered carousel slide;
only captured positive `media_type`/`product_type` carousel discriminators select
`carousel_media`, so stray child fields on a single item cannot change its shape.
each item exposes its direct CDN media URL, explicit download eligibility/source,
poster, dimensions when available, and video duration. A malformed carousel is
rejected as a whole so slide cardinality is never silently changed. Author
profile metadata, caption/counts, liked/saved state, and download eligibility
are parsed outside UI components.

Feed-post `music_metadata` is normalized at that same boundary into one optional
attached-audio entity: source, identity, title/artist, duration, asset offset,
and overlap duration. The modal keeps this soundtrack mounted across carousel
slides, pauses it on close, and mutes slide videos while it is active so two
audio sources cannot overlap. Its bottom-right control follows the native audio
element's actual paused and mute state: blocked autoplay first presents Play,
while an already-playing soundtrack presents Mute or Unmute. It also exposes a
volume slider backed by the same persisted global volume/mute preference as reel
and post videos. Replaced signed
URLs and timing metadata reinitialize the same slide-independent player, with
stale play outcomes ignored.

Reel-author profile images cross one additional trusted-media boundary. After
the anchor returns normalized reel metadata, the extension background fetches
only HTTPS `*.cdninstagram.com` image responses covered by its existing host
permission, refuses redirects, streams at most 2 MiB, and replaces the remote
author URL with a data URL. This avoids CDN CORP failures in the extension page
without weakening headers or teaching components Instagram host rules. A failed
optional avatar becomes `null` so the reserved initials fallback remains usable
and reel media does not fail with it.

Media loading no longer depends on the failing, uncaptured
`PolarisPostActionLoadPostQueryQuery`. The anchor prefers the validated numeric
media-ID hint normalized from a DM share; when absent, it decodes the shortcode
to the numeric media ID using the relationship proven by sanitized
`real-loading` captures. It then performs the captured authenticated
`GET /api/v1/media/<id>/info/` and accepts the result only when both REST `pk`
and `code` match. The parser retains all unique captured `video_versions`.

Every loaded initial or older history page scans its messages for reel shares.
The store deduplicates by shortcode, starts at most two reel preloads at once,
and spends at most eight preload starts per store lifetime. This includes inbox
warmups, so a later modal open reads the same cache synchronously rather than
creating a component-owned request/cache. Explicit open is outside that budget
and waits for an overlapping preload instead of issuing a duplicate request.

Comments are deliberately not part of preload. `openReel(shortcode, mediaId?)`
records modal intent, ensures media, and only then requests the initial comments
page. The modal loads subsequent pages only after the user scrolls the bounded
details panel near its comments tail; a short initial page does not recursively
drain cursors without user movement. The media stage remains fixed beside that
independently scrolling panel. The captured REST `next_min_id` is retained as an opaque
cursor and returned unchanged as `min_id`; its internal JSON is never interpreted.
Cursor presence is authoritative because captured continuation responses report
`has_more_comments: false` while still returning another `next_min_id`. Pagination
is single-flight and failure-gated until explicit retry. Closing before media
settles prevents the initial comments request. Comment rows
are normalized by comment ID. Like and save are separate per-reel single-flights:
the store applies the boolean/count change optimistically, accepts only a
matching media-ID/state receipt, and otherwise restores the snapshot while
retaining an error mutation for accessible UI feedback. The unlike capture
reported a stale `has_liked: true`; the operation-specific parser therefore
uses the matched unlike receipt as authoritative `false` rather than exposing
that contradictory field.

Forced reel-info refreshes reconcile independently with those like/save flights.
A refresh overlays pending intent while replacing its rollback baseline with the
fresh read; a later failure therefore restores refreshed metadata, not the
pre-request snapshot. If a matching mutation receipt settles after a refresh
started, that receipt's boolean and optimistic like count remain authoritative
over the older read while all unrelated refreshed metadata is retained. This
also protects a chained opposite mutation: the older read may update metadata,
but cannot replace that mutation's receipt-backed rollback baseline.

### Reel presentation and media shortcuts

Reel shares are buttons, never outbound reel links. They read the normalized
shortcode cache and open one modal over the application shell; the shell becomes
inert and hidden from assistive technology until close, background scrolling is
locked, focus is contained, and close by button, backdrop, or Escape restores the
invoking preview. The modal owns only presentation state (the stable carousel
index and native media element state). The application root retains a small
session-only playback record keyed by shortcode and media-item ID: current time
plus explicit user-paused intent. Media volume and explicit mute intent are one
global player preference, shared by every reel/post video and attached post
soundtrack and persisted in local storage; soundtrack-forced video muting does
not overwrite that preference.
Closing or changing slides snapshots time;
metadata readiness restores it. A new video autoplays, while a video explicitly
paused by the user remains paused when revisited. Each carousel video therefore
has independent progress without becoming a second media/entity cache. Author,
comments, mutation state, and ordered media remain store-owned. Comments
therefore appear only after open and
retain the store's explicit retry path. Modal image/video decode or CDN failures
retain cached media and metadata, show an accessible retry over the current
carousel item, and force the existing store-owned single-flight refresh. The
local failure indication clears only when the item/source changes; refreshed
comments start only after that media refresh succeeds while the same reel remains
active.

The independently implemented player uses native media decoding beneath custom
play, mute/volume, seek, time, and fullscreen controls. While a modal video is
already playing, holding Space for 250ms temporarily uses 2× playback and restores
the pre-hold rate on keyup, blur, pause, slide replacement, or modal teardown; it
never toggles play. Releasing Space before that threshold is a tap and toggles
play/pause exactly once. Cancelling a pending tap through blur or teardown does
not toggle playback.
Comma and period move a paused video by one frame. Instagram's current reel
contract exposes duration but no frame rate, so the UI uses a documented 1/30s
fallback. Editable targets keep their native keys. Carousel arrows and Left/Right
operate on the bounded `ReelMedia.items` order.

When multiple variants exist, the player exposes Auto (the parser's
highest-dimension/bandwidth candidate) and each explicit variant. A source
change restores current time, playing/paused intent, volume, mute, and playback
rate after replacement metadata loads. Variant selection is presentation state,
not another media cache.

Inline previews reuse the first cached reel item and reserve its normalized
source dimensions; while that cache is warming they use the normalized XMA
preview dimensions when Instagram supplies them. Item dimensions are required
at the reel parser boundary (original media dimensions first, then the selected
video/poster candidate), including every carousel child. Inline preview geometry
is calculated from aspect ratio, independent of source resolution, by fitting
proportionally within 300×300px. A 9:16, square, and 16:9 source therefore
reserves 168.75×300, 300×300, and 300×168.75 respectively. The wrapper and
media element share that source ratio, preventing the side bars that resulted
when portrait media was widened to a comfort minimum.
Source axes are normalized by their maximum before fitting, avoiding overflow
across all finite positive dimensions accepted by the parser. Each fitted axis
is continuously clamped to a CSS-layout-safe minimum of 1px because Chromium
parses subnormal inline `aspect-ratio` terms as zero. Geometry therefore remains
finite, positive, and renderable; below that floor the box intentionally stops
being exactly proportional to the source rather than claiming a ratio the
browser cannot lay out.
The reel message card takes the calculated width and `object-fit: contain` keeps
the source uncropped inside the exact wrapper/media element box through poster,
loading, image, and video states. On a narrower message column, the complete
card scales down while retaining that calculated box ratio. Modal stages derive
their own box from the current item's dimensions and fit it against both
available viewport axes. The dialog therefore follows portrait, square, and
landscape slides instead of exposing a fixed black stage around the media; the
comments column keeps a bounded independent width. On compact screens the
existing stacked full-viewport layout remains in effect, with stage container
units containing the media box. The first cached item is also an explicit
memoized-row prop:
asynchronous preload completion invalidates only its reel-bearing message row
instead of leaving the XMA dimensions/source mounted indefinitely.
Any cache-arrival geometry correction stays under the existing history
`ResizeObserver` anchor contract rather than media load handlers. Inline history
video never starts playback. It may preload metadata and display its poster, but
playback starts only from an explicit action in the modal player. An intersection
observer plus a direct 160px scrollport geometry check instead reports visible or
near-visible shortcodes to the store. The bounded two-request/eight-start preload
queue moves queued targets ahead. A normalized visible target outside the first
eight candidates displaces an unstarted low-priority candidate without increasing
the actual-start budget or creating a component cache; an
explicit open still joins an overlapping request. Comments remain excluded from
preload and begin only after explicit open and media readiness.

Shared reel and inline-post rows are media surfaces rather than generic message
bubbles. Their compact author identity is overflow-safe, their bubble background
and padding are removed, grouped reactions are a sibling beneath content, and
their absolute bottom-right timestamp is revealed only by row hover or focus.
Reply context and history-level date grouping remain intact. These behaviors are
independently implemented; no Telegram source, styles, icons, or assets were used.

### Pin normalization and displayed order

Pins load independently from inbox. `loadPins` deduplicates persisted IDs with a
`Set`, preserving the first occurrence. `orderedThreadIds()` then:

1. drops pinned IDs whose thread has not loaded;
2. emits loaded pinned IDs in persisted pin order;
3. emits inbox IDs not in that pinned set, preserving server order.

Conversation pin/unpin is store-owned and optimistic. `committedPinnedIds` is
the latest authoritative persisted baseline; `pinnedIds` is that baseline with
the ordered in-flight operation journal replayed in invocation order. Settled
operations commit only from the head of that journal, so cross-thread responses
cannot invert optimistic precedence even if they settle out of order. A failure
is removed from replay and retained as visible row error state. Pin reads capture
both a pin revision and a monotonically increasing read token. Only the latest
read in the current store generation may commit its data or ready/error status,
and only while its captured revision still matches. Thus overlapping refreshes
can run (including a post-mutation refresh) without an older success or rejection
overwriting the newer result. A read begun before a mutation cannot overwrite its
completed receipt, while a read that settles during an unchanged pending mutation
may refresh only the committed baseline beneath the still-replayed optimistic
operation.

The mutation uses the normalized
`Thread.threadFbid` operation identifier retained separately from `Thread.key`
(never substituting the opaque route/key). Mutation FBIDs and authoritative
receipt IDs must be numeric Instagram string IDs. The background serializes
durable updates, and the store reconciles only a matching authoritative
`{ id, is_pin }` receipt. Per-thread flights are deduplicated; failures roll back
the optimistic order and remain visible on the row. `Thread.serverIsPin` is read
metadata and is not substituted for persisted `pinnedIds`.

### Selection and initial history

`selectThread(id)` immediately writes `selectedThreadId`, records the thread as
opened, emits, then requests its initial history. Selection UI therefore changes
before the network resolves. `loadInitialHistory` returns when:

- that thread already has a request in `historyRequests`; or
- a history exists whose status is anything except `error`; or
- the inbox entity is unavailable.

Thus a warmed or previously opened `ready` history paints synchronously and is
not refetched. A failed history can be retried. `isPreloading` means only “this
initial one-page request was started by inbox warmup”; it is reset in `finally`.
Do not reuse it for older-page lookahead.

`MessagePane` renders the bounded viewport, opens new chats at the newest row,
restores visited chats from an ID-plus-offset anchor, groups adjacent senders,
and renders every current domain message variant and reply preview.

Reply previews with a `repliedTo` message ID are semantic buttons. The store-owned
`navigateToReply` action first checks normalized local history, then serially
consumes the existing older-history cursor until the target is loaded, history is
exhausted, or a request fails. It joins an older request already in flight,
failure-gates ordinary sentinel loading while navigation is active, and retains
accessible loading/error/ready state in `HistoryState.replyNavigation`. After a
click, each successfully consumed page updates honest page and newly normalized
message counts; no percentage is shown because Instagram supplies no total. Once
found, it replaces `viewportIds` with at most 80 IDs around the target; the pane
then performs the one DOM-owned operation: a non-animated centered scroll and
focus of the stable `data-message-id` row. Missing/deleted targets and transport
failures remain retryable alerts.

`isPositioned` is acknowledged by the pane only after that DOM operation. Older
sentinel reveal is paused between the ready viewport replacement and this
acknowledgement, preventing a still-visible top sentinel from replacing a return
target before it can be teleported and focused. Click-only loading, progress,
retry, and completion announcements are siblings of the message scrollport,
positioned against the conversation viewport; they never enter scroll content or
participate in row, anchor, or scroll-height measurement.

Visible or near-visible actionable previews report only their current target IDs
to the store. A global queue retains at most four targets including the active
one, drains one at a time through the same normalized older cursor and
per-thread single-flight, and spends at most one older page per visible target.
Background lookup never replaces the viewport or exposes click-only progress,
and a failed prefetch cursor is privately gated rather than surfacing an error.
Changing the visible target set or selected thread invalidates queued work and
prevents an obsolete task from starting another page; an already in-flight page
may still normalize. User navigation pauses queue draining, joins an in-flight
prefetch for its thread, and takes ownership after that page settles, continuing
without a page budget or duplicate cursor call. The pane attaches its observer
and immediately scans committed preview geometry rather than waiting for the
observer's asynchronous first delivery. Explicit navigation retains the latest
visible-target queue while paused and resumes still-relevant missing targets
after it settles. This bounds actual request work, not only queue memory, without
inventing a second message cache or an Instagram range-query contract.

A successful A→B reply navigation appends A to the history-owned return stack;
failed, stale, duplicate-top, and self navigation do not. The down-arrow control
unwinds the stack through the same load/reveal/focus action, committing each pop
only after success. Its accessible name reports the remaining return depth. Once
the stack is empty, the same icon goes to the exact newest 40-ID window and its
DOM bottom. Merely having the latest ID somewhere in an 80-row target window is
not newest state, and a rendered newest window remains actionable while its
bottom is offscreen.

The pinned Telegram Web A clean-room review (`message/hooks/useInnerHandlers.ts`
and `global/actions/ui/messages.ts` at `a323b1f`) showed that a reply click is
delegated to centralized message focus, loads a target viewport when absent,
focus-highlights the row, and reports inaccessible replies. ICR adopts that
behavior, not its outlying-range machinery. A sanitized review of a user-provided,
uncommitted local capture showed paired Instagram before/after anchor queries,
but only for isolated 20-message ranges;
it does not prove continuation needed to reconnect such a range to ICR's single
contiguous `listedIds`. The current implementation therefore uses the already
verified older cursor. This can require multiple 20-message requests for a very
old reply, trading latency for normalized continuity and unchanged pagination,
single-flight, and virtualization contracts.

Message parsing owns the explicit Instagram content-type inventory. Textual
conversation administration (group image/name changes, participant removal, and
new-friend notices) crosses the background/UI boundary as the protocol-neutral
`activity` message variant. Activity rows have no sender identity and are
centered and non-actionable. Known non-rich events carry a normalized friendly
fallback label/preview; `contentType` remains diagnostic metadata and is never
shown in normal inbox, history, or reply UI. Future unknown values use
“Unsupported message”, and malformed or absent media URLs never create image
entities.

Sender runs remain a presentation derived from normalized `viewportIds` and
`byId`; they are not another cache. A run breaks on sender, date, or the existing
five-minute grouping interval. In group chats, each incoming run reserves a
32px identity gutter, shows the sender name on its first message, and keeps one
avatar anchored to the run's last message or sticky at the scrollport bottom
while that last message is below the viewport. Outgoing runs never show either.
In a private thread, the ordinary peer has no identity gutter; a known additional
participant (for example Meta AI) gets the run avatar but not a repeated group
name. The existing normalized thread key identifies the ordinary peer when it
matches a known participant; otherwise only a sole known non-viewer participant
is accepted as the ordinary peer. Titles and participant order never determine
identity, and unknown senders receive no fallback avatar.
Run wrappers use their newest message's stable row key so prepending older
same-sender messages preserves wrapper DOM identity. The run wrappers remain
bounded by the same maximum 80 message IDs, and logical anchors continue to use
the nested stable `data-message-id` rows.

### Status, errors, and explicit retry

Initial inbox loading uses `inbox.status = 'loading'`; pagination leaves loaded
rows visible and uses `isLoadingMore`. A failed initial request sets status to
`error`. A failed later page retains existing data, stores `error`, and sets
`failedCursor` to the attempted cursor.

`loadNextInboxPage` refuses the same failed cursor. This prevents a near-end
effect from continuously retrying while visible. `retryInbox` explicitly clears
the gate and retries the current page, or restarts initial loading if no loaded
cursor exists. A “successful” page that returns the same cursor, says there is a
next page, and adds no IDs is treated as no progress and failure-gated.

History initial errors live on their own `HistoryState`; explicit
`retryHistory(id)` is allowed because `loadInitialHistory` accepts `error`
histories. Older failures retain cached messages, store `failedOlderCursor`, and
remain gated until `retryOlderHistory(id)` explicitly clears that cursor.

### Single-flight and stale generations

- `inboxRequest?: symbol` permits only one inbox request globally, including
  initial versus pagination.
- `historyRequests: Map<threadId, symbol>` permits one initial history request
  per thread while allowing different chats to warm concurrently.
- `olderHistoryRequests: Map<threadId, symbol>` permits one older request per
  thread across user-visible loads, short-viewport fills, lookahead, reply
  prefetch, and explicit reply navigation. Reply-prefetch targets are additionally
  globally serialized and bounded; explicit navigation takes queue priority.
- `sendRequests` permits one attempt per thread/local ID. Failed retries reuse
  the original 19-digit signed-64-bit `offlineThreadingId` and row rather than
  appending another message; different threads may send concurrently.
- `reactionRequests` permits one mutation per thread/message pair. The store
  snapshots reactions, applies the viewer choice optimistically, installs the
  response array on success, and rolls back with visible error state on failure.
  Local optimistic messages cannot be reaction targets. A history read that
  overlaps a pending reaction refreshes the rollback baseline while retaining
  the viewer's optimistic choice. It always removes the remote viewer entry
  first, so an optimistic removal remains absent until settlement. Authoritative
  arrays, including empty and timestamp-less arrays, replace accepted prior
  state; read ownership and reaction revisions, not aggregate timestamps, reject
  stale overlapping completions.
- `pinRequests` permits one conversation pin mutation per thread. The background
  serializes storage commits so persisted prepend order follows invocation order;
  other pending optimistic pins are replayed over each authoritative list.
- `reelMediaRequests` and `reelCommentRequests` permit one read per shortcode;
  opening during preload joins its settlement, while comments require open
  intent. `reelLikeRequests` and `reelSaveRequests` serialize those actions
  independently per shortcode.
- Reel retries force a fresh info read and atomically replace signed item URLs
  only after shortcode and media identity validation, so an expired CDN URL does
  not remain permanently pinned in cache.
- Every request captures the store `generation` and its unique symbol. Result,
  error, and `finally` mutation occur only when both still match.
- `destroy()` increments `generation`, clears listeners/request registries and
  warmups, and removes the inbox request marker. Late async completions are
  ignored. Requests are not physically aborted. Reply-navigation waits also race
  an owner cancellation signal, so both a waiter on shared older work and the
  direct owner of a never-settling RPC resolve `false` during teardown.
- Changing selection does not invalidate another thread's underlying RPC. It may
  safely finish into that thread's normalized cache. It does abandon explicit
  reply-navigation ownership: the action resolves `false`, clears its loading
  intent, and cannot later commit progress, error/ready state, viewport/focus
  intent, positioning acknowledgement, or return-stack changes. Reply-prefetch
  queue intent is likewise invalidated; an in-flight page may only normalize.

This protection is an ownership rule: all RPC actions need explicit
single-flight and stale-generation handling at the store boundary.

### Mutation reconciliation and follow rules

The store accepts only non-empty trimmed text in a ready history with a viewer
and mutation-capable thread ID. Acceptance clears that history's controlled
draft/reply target, preserves reply preview data on the optimistic message, and
updates the normalized inbox snippet/activity. Unpinned threads move to the
front; explicit persisted pin order remains authoritative. Inbox reads capture a
mutation revision and cannot regress an outgoing snippet that was accepted after
the read began (or one with newer activity).

Pending send failures keep the message and expose retry/remove. A successful
retry atomically installs the server ID/timestamp without a history refetch.
Reaction results similarly reconcile from the mutation receipt, not polling.
Malformed successful GraphQL envelopes become ordinary mutation failures at the
anchor boundary and therefore cannot install partial server state.

`MessagePane` owns only DOM geometry: it measures true bottom state immediately
before dispatch and records a thread-scoped follow intent. A bottom send appends
to the bounded window and scrolls after render. A send from a scrolled-up or
older local window leaves `viewportIds` and the logical anchor intact and shows
the accessible down-arrow control. Reply-return entries take precedence; once
none remain, its “Go to newest message” action switches to the newest 40 loaded
IDs before scrolling. Follow intent is cleared on thread changes so it cannot
affect a restored chat. Enter submits, Shift+Enter inserts a newline, and drafts
remain store-owned per thread.

Message and conversation-row action surfaces are component-owned transient DOM
state, not another entity cache. Desktop rows expose no permanent ellipsis or
menu button: right click, the Context Menu key, and Shift+F10 open native
top-layer popovers so transformed virtual rows cannot clip them. A stationary
500ms touch long-press is the compact-layout fallback; movement beyond 10px or
pointer cancellation cancels it so scrolling wins, and any generated browser
compatibility contextmenu/click is suppressed across the document so releasing
over a newly opened surface cannot activate it. The surfaces clamp using the visual
viewport's width, height, and offsets, reposition on visual-viewport resize or
scroll, and fall back to layout-viewport resize handling. They move focus to
their first enabled action, dismiss on outside press, Escape, document scrolling,
action, or thread replacement, and return focus after Escape. Message-row keys include
the thread identity so transient state cannot survive a switch between histories
that happen to contain the same message ID; optimistic/server reconciliation
within one thread still uses `rowKeyByMessageId` unchanged.

Plain `j`/`k` keys move within the active pane. In the inbox they clamp through
`orderedThreadIds()` and select the focused conversation; with no current chat,
either key establishes the first loaded conversation. In history they clamp
through the currently rendered bounded `viewportIds` rows without moving the
window or requesting a page. `h` returns to the selected chat row and `l` enters
the selected history, restoring a per-thread focused message ID when it remains
rendered or otherwise choosing the newest rendered row. Every movement reveals
the focused row with nearest-edge, non-animated scrolling. A short-lived DOM
scroll intent lets inbox and history handlers distinguish this navigation from
pagination intent, so keyboard movement neither fetches nor replaces a bounded
history window. This focus memory is DOM navigation state, not a message cache.
Inputs, textareas, selects, DOM-editable hosts and descendants (respecting
`contenteditable="false"`), modifier chords, context menus, reaction pickers, and
dialog-like surfaces suppress these bindings. Context-menu pin actions restore
the invoking row after reordering only while the originating selection and focus
intent remain current; focus/pane/thread changes, row teardown, and newer intent
cancel the queued animation frames.

On a keyboard-focused history row, Enter activates only an existing rendered
shared-post action: a `reel_share` uses the same internal reel-preview button,
while an `inline_share` with its parser-provided `targetUrl` uses the same
`target="_blank"` link. Plain text, images without an action, activity, and
unsupported rows do nothing; the UI neither derives nor invents Instagram URLs.
Plain Space on a reaction-capable server row applies `❤`, the default reaction.
The row treats an existing viewer `❤` as a safe no-op, and a pending mutation
remains single-flight. The row reads the
current normalized mutation and reaction synchronously: only a newly accepted
reaction prevents Space scrolling, while pending and already-default no-ops do
not. Editors, modifier chords, nested links/buttons, contextual surfaces, and
dialogs retain their native keys. These actions use the normalized current
message ID and existing stable row-key bridge, so pane focus survives thread
reuse without creating parallel selection or mutation state.

Menus expose only capabilities already owned by this frontend. Selected and
unselected chat rows offer Pin conversation or Unpin conversation by right click,
Context Menu/Shift+F10, or movement-cancelled touch hold. Pending actions are
disabled and mutation failures are announced on the affected row. A
loaded server message offers reply, and shared reel/post messages with a
parser-provided target URL additionally offer Copy post URL. Reactions remain
available through the row's hover/focus reaction rail and full chooser, not the
context menu. A failed local send offers retry/remove. The reaction picker marks the
viewer's current choice and serializes through the existing store action.
The same parser-provided URL follows the explicit open intent into the shared
reel/post modal, where an accessible icon-only Copy post action writes it to the
clipboard without reconstructing an Instagram URL in the component.
Selecting a placed reaction adds it when it belongs only to others and revokes
it when it includes the viewer; revocation uses the same routed mutation with
`reaction_status: 'deleted'`. Reply selection preserves a visible DOM anchor,
focuses the thread composer without browser scrolling, and remains isolated with
the store-owned per-thread draft/reply target.

Server message rows expose one compact default-reaction control only while the
row is hovered or contains keyboard focus. Hovering or focusing that control
progressively expands a horizontal rail to five additional recent reactions and
an expander; moving through its children keeps it expanded for pointer and
keyboard operation. It sits beyond the trailing edge for incoming messages and
leading edge for outgoing messages, is absolutely positioned so message geometry
and anchors do not change. The expander and contextual action
open one categorized, clamped, keyboard-operable full chooser. Its menu owns
labeled reaction groups containing radio menu items; Left/Right move by item and
Up/Down move deterministically between category rows. Picker state is
presentation-only while optimistic single-flight/error state remains normalized.
Context-menu keyboard handling lives on the focusable row itself; the browser
menu is prevented only for rows whose custom menu owns real actions.

### Incoming DM synchronization

Incoming synchronization uses bounded polling because available captures prove
the no-cursor initial inbox and thread-detail response shapes, but do not contain
decoded Iris/MQTT events or a stable page-runtime callback contract. Repeating
those requests is structurally the authoritative initial/newest-shape fallback;
live repeated-query freshness remains unverified pending authenticated
two-account validation. The store polls every five seconds only while the UI
document is visible. One poll is globally single-flight and shares the inbox
read flight with initial and pagination loads. Its selected-thread detail shares
that thread's read flight with initial and older history requests, without
serializing unrelated threads. Selected-thread detail is omitted while a send
for that thread is in flight; a response started just before a send is discarded,
and later polls resume normally. If a scheduled or visibility-triggered poll
collides with an ordinary inbox read, it consumes no second flight and installs
one replacement timer using the current interval/backoff delay. Thus settlement
or a bounded retry resumes polling without duplicate timers.
Failures back off exponentially to 60 seconds; becoming visible refreshes
immediately. `destroy()` clears the timer and visibility listener and invalidates
the flight by store generation. The existing closed UI→background→anchor RPCs
remain the only transport, so no unsolicited raw page data, credentials, tokens,
or Instagram response objects cross into UI code.

Both reads feed one protocol-neutral `IncomingDmSnapshot` reconciliation action.
It updates normalized inbox entities/order and only an existing ready history;
it never creates an unloaded history cache or changes older pagination cursors.
Messages deduplicate by server ID and sort chronologically. A poll captures
outgoing, send, and reaction-state revisions, so a stale completion cannot
regress an optimistic/confirmed outgoing snippet, duplicate an unsettled send,
or replace a pending/newer viewer or peer reaction. Older-page merges use the
same reaction-state revision guard. Explicit `pinnedIds` remain unchanged while
unpinned rows derive their activity order normally. The public snapshot boundary
accepts updates only while the store is started, so captured callbacks are inert
after teardown.

`MessagePane` reports only whether the selected history is both at the DOM bottom
and showing its latest loaded ID. An incoming tail then replaces the viewport
with the newest bounded 40 IDs and increments a follow version that the pane
scrolls after commit. When that measurement is false, reconciliation appends only
to `listedIds`; `viewportIds` and the logical anchor remain unchanged, and the
existing “Go to newest message” route becomes available. Reactions update their
existing rows without changing the window. A selection transition invalidates
the destination history's prior follow measurement before emitting; incoming
data remains conservative until the newly mounted/restored pane reports current
geometry. Because the pane is retained across selections, incoming-follow
acknowledgement records both thread ID and version: switching threads baselines
the destination version without scrolling, and only a later increment for that
same selected thread follows newest. Stale measurements from an unselected
thread are ignored. Measurements continue to apply normally while the same
thread remains mounted. The production browser harness
disables periodic polling and injects typed snapshots explicitly for deterministic
bottom-follow and scrolled-up anchor coverage.

### Warmup generations, timers, and budget

Warmup is deliberately small and selection-aware:

- `ChatList` passes the current bounded `visibleIds` after inbox/selected-history
  state changes.
- A changed visible-ID sequence increments `warmupGeneration`, clears scheduled
  timers, and replaces the membership set. This invalidates callbacks from the
  previous viewport.
- Warmup waits for a ready, non-paginating inbox and for selected history not to
  be loading.
- Candidates exclude the selected chat, any chat ever explicitly opened in this
  store lifetime, any existing history, and any in-flight history.
- At most two candidates are budgeted. Timers start at 100ms and 200ms. A timer
  rechecks generation, visibility, selection/opened/cache/request state, and
  inbox idleness before incrementing the budget and loading one initial page.
- `selectThread` cancels timers and resets the two-chat budget. Merely scrolling
  to another visible window cancels stale timers but does **not** reset already
  consumed `warmupsStarted`; this prevents unbounded warming while scrolling.
- `destroy` also invalidates and clears all timers.

The store can warm two different chats concurrently after their staggered
timers. “Single-flight” is per history, not one global history request.

### Store notification and Teact ownership

The store mutates one state object and calls every listener synchronously.
`App.useStore` subscribes once, starts inbox/pin loading, and increments a Teact
state version on each emit. Its cleanup unsubscribes and destroys the
application-scoped store. Components read the same normalized state after that
render request. Do not mutate store state from components or create a competing
signal/context cache.

## Current inbox virtualization geometry

The chat list is a fixed-height virtual window, not a generic virtualizer:

- row height: exactly `72px` in `App.tsx`, `virtual-list.ts`, and SCSS;
- nominal visible window: 25 rows;
- overscan: three rows before and after, so at most 31 rows for a sufficiently
  large data set;
- `firstVisible = floor(scrollTop / 72)`;
- `start` is clamped between zero and `itemCount - 31`;
- `end = min(itemCount, start + 31)`.

The spacer height is `ids.length * 72`. Each row is `position: absolute` at
`top: 0` and receives `translateY(index * 72px)`. The spacer uses
`teactFastList`; each direct row component is keyed by stable thread ID. Avatar
width/height are reserved and images lazy-load to avoid reflow.

When `end >= ids.length - 5`, the component asks the store for the next page.
The store's has-next/cursor/failure/single-flight gates decide whether a request
is legal. Later pages never replace loaded rows with a full-screen loader.

Keep `ROW_HEIGHT` synchronized in all three sources if product requirements ever
change. Keep this fixed geometry separate from variable-height message history.

## Milestone 2: implemented history behavior

Milestone 2 replaced only the temporary `MessagePane` path and extended the
existing store; the shell and inbox path remain unchanged.

### History state and bounded IDs

Add, per history:

```ts
viewportIds: string[];       // bounded DOM slice, oldest -> newest
isLoadingOlder: boolean;     // user-visible older request
isPreloadingOlder: boolean;  // exactly one adjacent lookahead request
failedOlderCursor?: string;
scrollAnchor?: { id: string; offset: number };
// plus a replacement/sentinel guard as required by the implementation
```

`listedIds` remains all contiguous loaded IDs, oldest-to-newest; `byId` remains
normalized lookup. `viewportIds` exposes 40-message slices and at most 80 rows to
the DOM. Merge an older page before existing IDs, deduplicate overlaps by
message ID, and retain the returned cursor/has-next metadata. A response for a
non-selected chat may populate only that chat's cache; it must never move the
selected view.

### Local-before-network behavior

The top trigger keeps durable intersection intent and first expands/moves
`viewportIds` into already loaded older IDs. Only when the local older side is
exhausted may it request
`getThread({ threadKey: thread.cursor ?? thread.key, cursor: history.cursor })`.
After a user-visible older fetch, preload exactly one adjacent older Instagram
page at low priority and merge it into `listedIds` without expanding
`viewportIds`. Apply a leading one-second trigger debounce and per-thread
single-flight. Failed cursors wait for explicit retry.

If selected initial history is shorter than the viewport, continue one page at
a time until content fills it or `hasOlder` is false. This auto-fill applies
only after selection. An unopened warmed history remains exactly one page.

### Sentinel and anchor preservation

- Put one top sentinel inside measured message content and observe it with a
  `750px` root margin so loading starts before the user reaches the top.
- Disable the trigger while DOM-window replacement is active.
- Network pages merge into `listedIds` without changing the DOM window. Just
  before the subsequent synchronous `viewportIds` replacement, choose the
  second surviving visible message (fallback first) and record its viewport
  top. This keeps the anchor current when the user scrolls during a delayed RPC.
- Commit new `viewportIds`, then use Teact `useLayoutEffect` to measure the same
  row and add its top-position delta to `scrollTop`.
- Keep loading UI outside measured message rows. Reserve known media aspect
  ratios. If media above the anchor changes height, use `ResizeObserver` and the
  same anchor correction rather than a raw `scrollHeight` delta.
- Restore visited chats from an ID-plus-offset logical anchor and open a new
  history at the newest message without animated scrolling.

Focused coverage includes an overlapping-page state regression and a Vite+
Playwright harness that mounts the production Teact `App` and store. It verifies
continuously intersecting sentinel drain with exact request/preload counts,
delayed-RPC anchor drift below 1px after user scrolling, and resize correction
through the production `ResizeObserver` path.

Mutation coverage is split at the same ownership boundaries. Catalog/handler/
parser tests pin exact text/reply/reaction variables, authoritative receipts,
reaction normalization, and malformed HTTP-200 data. Store tests cover send
insertion, duplicate-safe retry, all-index reconciliation, stable row keys,
bounded/scrolled-up windows, inbox read races, per-thread drafts, reaction
single-flight/rollback/read overlap, and stale completions. Production browser
tests cover composer keys, reply/cancel, descriptive actionable-row names,
accessible delivery recovery and emoji
picker, narrow layout, stable DOM identity, bottom follow, older-window anchor
preservation/newest navigation, thread-scoped follow state, contextual action
dismissal/focus/collision behavior, visual-viewport offset/size changes,
current-reaction keyboard selection, and Chromium CDP-dispatched movement and
cancellation before threshold plus a held active touch moved onto a newly opened
action before release. The generated compatibility click is observed and proven
unable to activate the action, followed by an ordinary click that proves cleanup.

Replacement state lives in normalized history while DOM measurements remain in
`MessagePane`. Intersection state survives observer transitions and reevaluates
after debounce, request/preload settlement, replacement, and resize. The store
merges remote pages first; `MessagePane` then records the second surviving row
at commit time and synchronously asks the store to move the bounded window.
`useLayoutEffect` corrects that row before replacement is released, and
`ResizeObserver` reuses the logical anchor. This intentionally omits Telegram's
generalized scrolling framework.

## Telegram Web A-derived decisions

### Provenance and clean-room boundary

The reviewed design was informed by pinned
[`Ajaxy/telegram-tt@a323b1f`](https://github.com/Ajaxy/telegram-tt/tree/a323b1f29f5b91e9a32b8c14866234e925fb0bfa),
which is GPL-3.0-or-later. This repository currently has no compatible project
license. Do not copy Telegram source text, styles, icons, or assets. Preserve an
independent explanation/implementation of behavior and the separate MIT Teact
provenance. Direct adaptation is allowed only after an explicit GPL-compatible
licensing decision and required notices/source obligations.

Useful pinned observations and ICR decisions are indexed in
[`frontend-rewrite-plan.md`](./frontend-rewrite-plan.md#what-to-reuse-from-telegram-web-a).
In particular:

- Telegram `ChatList.tsx` informed bounded ordered-ID windows and fixed 72px
  absolute rows. **Implemented now:** 25 rows plus 3+3 overscan in ICR's own
  helper and SCSS.
- Telegram message actions informed separate loaded/listed IDs versus viewport
  IDs and local-before-network expansion. **Implemented:** normalized
  `listedIds`, bounded `viewportIds`, and local-first movement.
- Telegram infinite-scroll/message-list code informed early sentinel triggering,
  short-viewport fill, and surviving-element anchor correction. **Implemented:**
  one top sentinel, 750px load-ahead, and layout-phase anchor correction.
- Telegram config/preload behavior informed 40/60-style bounded message slices
  and adjacent preload. **Implemented adaptation:** 40-message slices, max 80
  DOM messages, exactly one older lookahead page, and only two visible unopened
  chat warmups rather than Telegram's wider policy.
- Telegram sender groups informed identity placement: one avatar belongs to an
  incoming sender run and sticks at the visible bottom until the run's final
  message reaches it, while the sender name belongs to the run's first message.
  **Implemented adaptation:** direct CSS sticky positioning inside ICR's bounded
  run wrapper, with Instagram PM/non-peer rules and no imported Telegram markup,
  styles, or assets.

These are architectural observations, not permission to import GPL code.

For contextual actions, a clean-room review of pinned `Message.tsx`,
`Message.scss`, `MessageContextMenu.tsx`, and `useContextMenuHandlers.ts`
concluded that Telegram Web A keeps desktop message actions contextual, places
its quick-reaction affordance on opposite outer bubble corners for incoming and
outgoing messages, opens custom menus from pointer context-menu coordinates,
and uses a movement-cancelled touch hold while suppressing the resulting click.
ICR independently adopts only those interaction conclusions with its own DOM,
timing, styling, six-reaction capability, focus semantics, and viewport surface
helper; no Telegram source, styles, markup, icons, or assets are copied.

### Complexity intentionally excluded

Do not reintroduce Telegram-scale machinery without measured need:

- eager loading of every inbox page;
- outlying/around-message ranges or forward network pagination;
- forums, topics, scheduled messages, unread jumps, search,
  attachments/live typing, live tails, and full media playback systems;
- Telegram's global action framework, MTProto/GramJS worker, PWA/Tauri stack,
  folder/multi-tab viewport system, heavy-animation registry, FasterDOM,
  generalized observer abstraction, or custom scroll animator;
- full history persistence before bounded memory behavior is proven;
- reorder drag/drop and reorder animation before live inbox updates exist;
- a generic virtual-list abstraction spanning fixed chat rows and variable
  message rows.

Use native observers/scrolling and direct helpers. Add scheduler or observer
abstractions only if a performance trace demonstrates the native design misses
the budgets.

## Performance, style, and accessibility invariants

### Dark visual tokens and floating shell

`entrypoints/ui/styles.scss` owns the dark-by-default visual system. Semantic
CSS custom properties on `:root` are the source of truth for canvas, panel and
elevated surfaces, hover/selection, primary/muted text, accent/focus, danger,
scroll cues, and incoming/outgoing messages. Components consume those
properties; data state and theme values do not move into `App.tsx` or the frontend store.
There is intentionally no light-theme branch in the current product scope.

The desktop shell uses 16px outer spacing and a 16px inter-panel gap. The
sidebar is a horizontally resizable, full-height 24px-radius floating island, while the
conversation title is contained by its own 32px-radius floating header. The
title text is not a separate decorative chip. Interactive rows and status/control surfaces use a
shared 16px radius, layered dark backgrounds, spacing, and restrained elevation
rather than decorative light borders. Borders remain only when they communicate
focus, danger, reply context, loading progress, or another functional affordance.
Scrollbars remain six pixels wide.
Chat rows remain exactly 72px high: their eight-pixel horizontal inset and
rounded fill do not change the spacer or translate geometry.

Responsive shell presentation belongs to `styles.scss`; selection remains in
the normalized store and `App.tsx` derives the shell modifier from
`selectedThreadId`. On desktop, an independently implemented 12px separator in
the existing 16px panel gap adjusts the grid's sidebar track. The preferred
width defaults to 390px, is clamped to 280–520px while reserving at least 320px
for the conversation, and may become slightly narrower than 280px at desktop
viewport widths from 641–647px to preserve that conversation minimum. Pointer updates
do not alter chat IDs, row height, spacer height, scroll position, or the
fixed-row virtual window. Arrow keys adjust by 10px (40px with Shift), Home/End
select the current bounds, and double click restores the default. The semantic
vertical separator exposes its current/min/max values and visible focus.

The preferred desktop width is a presentation-only local preference under
`icr:sidebar-width`; it is validated on read and persisted after pointer or
keyboard changes. Viewport clamping does not overwrite that preference, so a
temporary narrow window can recover the chosen width when expanded. Preference
storage is best-effort: denied reads/writes/removals fall back to the default or
continue the current interaction. Viewport width is independently reactive so
separator min/max semantics update even when the clamped width itself does not.
Pointer up, cancellation, lost capture, and component teardown share one
idempotent cleanup path for capture and the global resize cursor. At 640px
and below the separator is absent from layout and CSS shows the inbox when
selection is empty and the
conversation when selection exists. The compact back button dispatches
`showInbox`, which clears selection without deleting cached history, bounded
viewport IDs, or logical anchors. It does not create a second responsive state
owner. At heights of 520px and below, outer padding, gaps, radii, and island
shadows are removed; inbox and history keep their internal scrolling, stable
scrollbar gutters, and six-pixel scrollbars within the full viewport height.

Existing transient UI (`ListState`, inbox/history tails, history loading and
errors, beginning markers, and date markers) shares the `status-surface` visual
treatment. This is a styling convention for rendered surfaces, not a generic
popup component or new state owner. Empty/welcome states, message cards, reply
previews, and retry controls use the same layered palette and radius scale.
Pressed states reduce opacity, focus remains a visible outline, and danger,
reply-context, and spinner borders are retained only for their functional cue.

Only transform and opacity are used for interaction motion, with the global
reduced-motion override retained. Sidebar width follows input directly rather
than using a layout transition; the separator's opacity cue is covered by that
override.

- Keep chat DOM at no more than 25 plus six overscan rows and history DOM at no
  more than 80 message rows.
- Never request the same cursor concurrently. Preserve explicit failure gates.
- Keep page merges and viewport shifts below a 50ms long task; planned prepend
  anchor drift is below 1px.
- Pass IDs/select normalized entities so page append does not recreate every
  entity or duplicate domain objects.
- Use stable keys and `teactFastList` only under its direct-child rules.
- Animate transform/opacity, not layout. Honor `prefers-reduced-motion` and
  reserve image/media dimensions.
- Keep semantic actions, keyboard focus, visible focus styles, loading status,
  errors, empty states, and selected state accessible while windows move.
- Do not add React as a runtime. Follow the local Teact caveats in
  [`teact-guide.md`](./teact-guide.md).

## Change checklist

Before changing frontend behavior:

1. Identify whether inbox reads, bounded history, or DM mutations own it.
2. Keep the RPC signature in `lib/domain.ts`, transport in `rpc.ts`, async/cache
   policy in the existing store, pure geometry in a helper, and DOM in TSX.
3. Preserve normalized `ordered/listed IDs + byId`, stable keys, cursor meaning,
   single-flight, explicit retry, generations, and the warmup budget.
4. Add focused state tests for merge/order/cursor/window boundaries. Add browser
   coverage for DOM measurement/anchor behavior rather than pretending Node
   store tests verify it.
5. Run:

```sh
npm test
npm run check
npm run build
git diff --check
```
