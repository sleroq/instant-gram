# Frontend MVP rewrite plan

Status: Milestones 1 and 2 complete

Telegram reference: [`Ajaxy/telegram-tt@a323b1f`](https://github.com/Ajaxy/telegram-tt/tree/a323b1f29f5b91e9a32b8c14866234e925fb0bfa)

Scope: chat list, message history, and low-latency infinite history scrolling

This plan supersedes the Svelte/TanStack implementation described in `.beans/icr-03bb--virtualized-chat-history-foundation.md`.

## Decision and constraints

The removed frontend was Svelte 5 with TanStack Virtual. The replacement will follow Telegram Web A's stack and architecture: TypeScript/TSX, Teact's React paradigm, SCSS, and the Vite pipeline already provided by WXT.

Telegram vendors its current Teact runtime in the application. Do not import React as an additional runtime merely because Telegram keeps React packages for compatible types and tooling.

There is one mandatory licensing boundary:

- `telegram-tt` is GPL-3.0-or-later. This repository currently has no license. Its source, styles, icons, and assets must not be copied until the project is made GPL-compatible and the required notices/source offer are in place.
- The separately published [`Ajaxy/teact`](https://github.com/Ajaxy/teact/tree/c822425ca286466c51d04e35fe2acff506437ee5) runtime is MIT-licensed, but older and not packaged for npm. The default implementation path is to vendor the smallest working runtime from that pinned MIT source, preserve its license, and independently implement the Telegram-derived list/history techniques described below.
- If this project is explicitly licensed GPL-3.0-or-later before implementation, the named Telegram files may instead be adapted directly with provenance and modification notices.

This plan deliberately does **not** copy Telegram's global framework, MTProto/GramJS worker, PWA/Tauri setup, folder system, multi-tab state, composer, live updates, message search, or media playback machinery.

## Existing contracts that remain authoritative

The frontend calls the background through the contracts in [`lib/domain.ts`](../lib/domain.ts):

```ts
getInbox({ cursor? }): Result<Page<Thread>>
getThread({ threadKey, cursor? }): Result<ThreadMessages>
getPins(): { pinned: string[] }
togglePin({ threadKey }): { pinned: string[] }
```

Important Instagram semantics:

- Initial inbox and inbox pagination have separate upstream queries but share `getInbox` in the UI contract.
- A thread's request key is `thread.cursor ?? thread.key`; the first history request omits `cursor`, and older requests pass the returned cursor.
- Instagram returns 20 messages per history page. The parser already presents each page oldest-to-newest.
- Pagination only exposes **older** network history. “Newer” navigation is local movement through already loaded IDs, not another API direction.
- Merge by `message.id`; pagination responses may omit `ThreadMessages.thread`.
- `viewerId` determines incoming/outgoing presentation.

See [`instagram-har-useful-requests.md`](./instagram-har-useful-requests.md) for the HAR-backed cursor paths and query shapes.

## What to reuse from Telegram Web A

“Reuse” below means copy only after resolving the GPL boundary; otherwise reimplement the documented behavior without copying source text.

| Telegram source | Useful behavior | MVP adaptation |
| --- | --- | --- |
| [`ChatList.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/left/main/ChatList.tsx#L100-L115) | Ordered IDs are reduced to a small render window. | Keep normalized threads and render a 25-row window. |
| [`ChatList.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/left/main/ChatList.tsx#L203-L251) | Fixed 72px rows are absolutely positioned inside a full-height spacer. | Use the same geometry; avoid a general virtualization dependency. |
| [`useInfiniteScroll.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/hooks/useInfiniteScroll.ts#L15-L96) | A bounded viewport first consumes local IDs, then asks for remote data. | Implement separate chat-list and history window helpers rather than a generalized hook. |
| [`messages.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/messages.ts#L186-L320) | `listedIds` and `viewportIds` are separate; local data is used before the network; one adjacent slice is budget-preloaded. | This is the core history state model. Omit outlying/search ranges and bidirectional network calls. |
| [`useScrollHooks.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/hooks/useScrollHooks.ts#L47-L125) | Sentinels trigger early through an observer root margin; requests are leading-debounced and disabled during DOM replacement. | One top sentinel, 750px root margin, and one request in flight per thread. |
| [`MessageList.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/MessageList.tsx#L758-L813) | Short initial history keeps loading until it fills the viewport; a surviving row is measured before replacement. | Repeat initial pagination only while content is shorter than the viewport and older pages exist. |
| [`MessageList.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/MessageList.tsx#L1000-L1138) | After layout, scroll is corrected by the anchor's top-position delta. | Preserve the second surviving rendered message across prepend/window shifts using a layout-phase correction. |
| [`MessageListContent.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/middle/MessageListContent.tsx#L634-L663) | History triggers live inside the bounded message content. | Keep the top trigger in the same measured content; keep loading UI outside message rows. |
| [`config.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/config.ts#L80-L92) | Chat rows are 72px; message slices are 40/60 and capped at two slices. | Start with 72px chats, 40-message slices, and at most 80 rendered messages. |
| [`preloadTopChatMessages`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/actions/api/chats.ts#L160-L181) | Likely chats are warmed in the background at a controlled cadence. | Warm only the first two visible, unopened chats after inbox idle; Telegram's top-20 policy is excessive for Instagram. |
| [`InfiniteScroll.tsx`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/ui/InfiniteScroll.tsx#L98-L163) | Short lists preload and prepends retain an element anchor. | Reuse the behavior, not the broad reusable component API. |

### Complexity to leave behind

- Telegram's eager loading of every chat-list page. Fetch the next Instagram inbox page only when the 72px list window approaches its loaded end.
- Outlying message ranges, around-message network fetches, forwards network fetches, forums, topics, scheduled/saved messages, comments, unread jumps, and live typing tails.
- Global heavy-animation registration, FasterDOM, custom animated scrolling, callback-multiplexed observers, and multi-tab viewport state.
- Full message-history persistence. Persist only recent thread metadata and the latest bounded history for fast reopen after its memory behavior is proven.
- Chat reorder drag/drop and Telegram's `useOrderDiff`. Use transform/opacity transitions for insert/select states; add reorder animation only when live inbox updates exist.

## State model

Keep API entities normalized and rendering windows separate from loaded data:

```ts
type FrontendState = {
  inbox: {
    orderedIds: string[];
    byId: Record<string, Thread>;
    cursor?: string;
    hasNextPage: boolean;
    status: 'idle' | 'loading' | 'ready' | 'error';
    isLoadingMore: boolean;
    failedCursor?: string;
  };
  pinnedIds: string[];
  selectedThreadId?: string;
  histories: Record<string, {
    byId: Record<string, Message>;
    listedIds: string[];       // all contiguous loaded IDs, oldest -> newest
    viewportIds: string[];     // bounded DOM window, oldest -> newest
    cursor?: string;
    hasOlder: boolean;
    viewerId?: string;
    status: 'idle' | 'loading' | 'ready' | 'error';
    isLoadingOlder: boolean;
    isPreloading: boolean;      // existing initial chat-list warmup
    isPreloadingOlder: boolean;
    scrollAnchor?: { id: string; offset: number };
  }>;
};
```

Actions own RPC calls and stale-response checks. Components receive IDs and select individual entities so an appended page does not rerender every row. Each thread has one initial request and one older-page request at a time.

## Implemented baseline and handoff

Milestone 1 is implemented in `entrypoints/ui/` and was independently reviewed after its blocking findings were fixed.

- `main.tsx` mounts one application-scoped store through the vendored Teact runtime.
- `store.ts` already owns normalized inbox/history entities, cursor pagination, explicit retries, request-generation guards, pin deduplication, selection, one-time initial history loading, and the two-chat warmup budget.
- `virtual-list.ts` provides the bounded 25-row chat window with three rows of overscan on each side. Keep chat-list geometry independent from variable-height history geometry.
- `App.tsx` contains the current shell, virtualized chat list, and bounded `MessagePane`. Milestone 2 replaced only the message-pane implementation without rewriting the shell or inbox path.
- `rpc.ts` is the typed frontend transport. Older history must call `getThread({ threadKey: thread.cursor ?? thread.key, cursor: history.cursor })`; do not confuse the stable thread request key with the page cursor.
- `vendor/teact/` is pinned MIT code with local modifications documented in its README. Teact already exports `useLayoutEffect`, `useRef`, and `memo`, which are sufficient for anchor correction and bounded message rendering. Do not add React as a runtime.
- `HistoryState.isPreloading` currently means an initial page is being warmed from the chat list. Do not overload it for older-page lookahead; add distinct `isLoadingOlder` and `isPreloadingOlder` state in Milestone 2.
- A warmed history is already `ready` when selected. Selection must reuse it, then run the selected-chat viewport-fill/older-load logic without refetching the initial page.
- Failed inbox cursors remain blocked until explicit retry. Preserve this behavior when adding history pagination; failed older cursors must likewise not retrigger continuously while the sentinel remains visible.
- Current focused checks use Node's test runner through `npm test`. There is no component/browser test harness yet; Milestone 2 must add the narrow browser-level anchor regression required below.

Milestone 1 verification at handoff: typecheck passed, 8 state/window tests passed, production WXT build generated `/ui.html`, and the review verdict was **approved with no release blocker**.

## Milestone 1 — Teact shell and virtualized chat list (complete)

### Deliverables

1. **Bootstrap the Telegram-style stack**
   - Restore `/ui.html`, because `entrypoints/background.ts` opens that exact path.
   - Integrate the pinned MIT Teact runtime with WXT/Vite TSX and preserve its `LICENSE`; validate the automatic JSX runtime and production build before adding features.
   - Add SCSS/Sass with a small token sheet for Telegram-like colors, radii, shadows, row dimensions, and motion durations.
   - Add a typed UI RPC adapter over `webext-bridge`; do not move Instagram request knowledge into components.
2. **Build the normalized store**
   - One small action/store module, no Redux-like middleware or Telegram global-action framework.
   - Load `getInbox({})`, normalize threads, merge subsequent pages by `thread.key`, and keep stable ordered IDs.
   - Load pins independently and derive pinned ordering without duplicating thread objects.
   - Ignore stale responses after teardown and expose explicit loading/error/empty states.
3. **Implement the chat-list loading path**
   - Fixed 72px rows in a full-height spacer; render 25 rows plus a small overscan.
   - Move the local window from scroll position. When the window approaches the loaded tail, request the next inbox cursor once.
   - Reserve avatar dimensions and lazy-load images to avoid list reflow.
   - On selection, show the selected state immediately and begin that thread's initial history request.
   - After the inbox and selected history are idle, warm at most the next two visible chats, 100ms apart; cancel when the user selects another chat.
4. **Match the useful visual language**
   - Two-column Telegram-like desktop shell, 72px chat rows, circular avatars, selected-row fill, timestamp/snippet hierarchy, muted/pinned states.
   - Use transform/opacity transitions only; honor `prefers-reduced-motion` and avoid animating layout properties.

### Acceptance criteria

- `/ui.html` opens from the extension and production build/typecheck pass.
- The first inbox page paints once available; later pages append without replacing the list with a loader.
- Scrolling hundreds of loaded threads keeps the row DOM bounded and does not visibly jump.
- A page cursor is never requested twice concurrently, and duplicate thread IDs do not render.
- Selecting an already cached chat starts no duplicate initial-history request.

## Milestone 2 — Bounded history, preloading, and stable infinite scroll (complete)

### Deliverables

1. **Extend the existing history cache**
   - Keep the implemented initial-page path: `getThread({ threadKey: thread.cursor ?? thread.key })` already normalizes and caches the page.
   - Add `viewportIds`, `isLoadingOlder`, `isPreloadingOlder`, failed-older-cursor gating, and per-thread logical scroll state to the existing `HistoryState`; do not introduce a second store.
   - Keep all contiguous loaded IDs in `listedIds`, but expose at most 40–80 IDs through `viewportIds`.
   - Merge older pages before existing IDs, deduplicate by `message.id`, and retain the newest response's cursor/`hasNextPage` metadata.
   - Switching chats renders cached history synchronously and restores an ID-plus-offset anchor; stale responses may update their own cache but never change the selected view.
2. **Match Telegram's load-ahead behavior within Instagram's API**
   - Place a top sentinel inside message content and observe it with a 750px root margin.
   - A trigger first expands the viewport from already loaded `listedIds`. Fetch only when the local older side is exhausted.
   - Use a leading 1s debounce plus per-thread single-flight protection.
   - After a user-visible older fetch, request exactly one additional older Instagram page as a low-priority preload, merge it into `listedIds`, and do not expand `viewportIds` until needed.
   - If the initial history is shorter than the viewport, continue page-by-page until it fills or `hasOlder` is false.
   - Apply automatic viewport filling only to the selected chat. Unopened warm histories remain one page until selected.
3. **Preserve the viewport across prepends and dynamic content**
   - Before changing `viewportIds`, choose the second surviving visible message (fallback to the first), and record its DOM top.
   - Mark history replacement active so the sentinel cannot retrigger.
   - Commit the new window, then in the layout phase calculate the same row's new top and adjust `scrollTop` by the delta.
   - Clear replacement state on the next measurement frame. Keep the loading indicator outside measured message rows.
   - Reserve known media aspect ratios. When content above the anchor changes height, apply the same anchor correction through `ResizeObserver` rather than a raw `scrollHeight` delta.
4. **Bound rendering and polish history presentation**
   - Render text, reaction logs, reel shares, inline shares, unsupported items, reply previews, date separators, and adjacent-sender grouping from `lib/domain.ts`.
   - Memoize message rows by message identity; activate heavy media only near the viewport.
   - Open at the newest message without a scroll animation. Animate only newly arriving/selected UI with Telegram-like 160–220ms transform/opacity transitions.
   - Show a lightweight top loading affordance without blanking cached messages.
5. **Add focused regression coverage**
   - State test: overlapping pages deduplicate and retain chronological order/cursor state.
   - Browser test: prepend an older page containing variable-height rows and verify the anchor's viewport top changes by less than 1px.
   - Browser test: repeated sentinel intersections create one request and preload at most one adjacent page.
   - Preserve the existing inbox retry, history retry, warmup, pin-ordering, and chat-window tests.

### Acceptance criteria

- Initial history opens at the bottom and automatically fills short viewports.
- Scrolling upward begins loading before the user reaches the top; cached/preloaded pages appear without a network wait.
- Prepending older messages and loading media above the viewport cause no visible jump.
- No more than 80 message rows are mounted, even after loading a long history.
- Returning to a visited chat paints cached messages immediately at its prior logical position.
- End-of-history, loading, empty, unsupported-message, and RPC-error states are visible and do not destroy cached content.

## Verification and performance budget

For each milestone run typecheck and a production WXT build. Milestone 2 additionally runs the focused state/browser checks above.

Use browser performance traces on a history containing at least 1,000 cached IDs and variable-height media. The MVP target is:

- at most 25 plus overscan chat rows mounted;
- at most 80 message rows mounted;
- no duplicate cursor requests;
- no long task over 50ms caused by a page merge or viewport shift;
- anchor drift below 1px after an older-page prepend.

Do not add Telegram's scheduler, observer abstraction, or custom scroll animator unless a trace demonstrates that the native implementation misses these budgets.
