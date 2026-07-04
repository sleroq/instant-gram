Research confirmed the reel-video path. Here's the concise plan.

---

# MVP plan: Instagram DM client via Chrome MV3 extension

## Architecture (3 entrypoints, WXT + Svelte 5 + TS)

```
instagram.com tab (anchor)          background SW              UI tab (extension page)
┌─────────────────────┐         ┌──────────────────┐       ┌────────────────────────┐
│ content script      │ <-msg-> │ router +         │ <-msg->│ Svelte 5 chat client   │
│  - harvest tokens   │         │ pin store        │       │  chat-list | history   │
│  - authenticated    │         │ (chrome.storage) │       │  | reel viewer         │
│    graphql fetcher  │         │ anchor-tab mgr   │       │ domain types only      │
└─────────────────────┘         └──────────────────┘       └────────────────────────┘
   same-origin fetch               webext-bridge RPC          never calls IG directly
   (cookies+csrf auto)
```

- **Content script** (`entrypoints/ig-anchor.content.ts`, matches `https://www.instagram.com/*`): sole actor that talks to IG. Harvests `fb_dtsg`, `lsd`, `jazoest`, `csrftoken`, `device_id_for_iris_subscription`, `viewerId` from the page's embedded `data-sjs` JSON. Exposes typed RPC handlers that do same-origin `fetch('https://www.instagram.com/...graphql', …)`. Re-harvests `fb_dtsg` on any auth failure (it rotates).
- **Background SW** (`entrypoints/background.ts`): ensures exactly one IG anchor tab exists (reuse any `instagram.com/*` tab; else create one — may stay backgrounded); routes UI↔content messages; owns pin store in `chrome.storage.local`; opens the UI tab on action click.
- **UI page** (`entrypoints/ui/index.html`, opened in its own tab): the whole chat client. **Never** calls IG itself — only consumes clean domain types returned over `webext-bridge`.

## Types & discipline (the "know what's going on" requirement)

Single boundary parser in the content script turns raw GraphQL JSON into narrow domain types; the UI sees only these:

```ts
type Thread = { key: string; title: string; isGroup: boolean; isMuted: boolean;
  folder: 'PRIMARY'|'GENERAL'|'REQUESTS'; lastActivityMs: number; serverIsPin: boolean;
  users: User[]; lastMessage?: Message; cursor?: string }
type User = { id: string; username: string; fullName: string; picUrl: string|null }
type Message =
  | { kind:'text'; id:string; senderId:string; ts:number; text:string; repliedTo?:string }
  | { kind:'reaction_log'; id:string; ts:number; fragment:string }
  | { kind:'reel_share'; id:string; senderId:string; ts:number; shortcode:string;
      targetUrl:string; thumbUrl:string; author:string; caption?:string }
  // …extend union as new content_types appear; UI switch is exhaustive
type ReelMedia = { shortcode:string; videoUrl:string; durationSec:number; owner:string }
```

- Discriminated unions for `Message` keyed by `content_type`/`content.__typename`; no `any`, no `as`, no `?.`-ladder. New `content_type` → compiler forces a UI branch.
- UI state is an explicit state machine per view (`idle|loading|ready|error`) — no boolean-flag soup.
- No speculative try/catch or fallback paths; one error channel from content script → UI.

## GraphQL call table (pin `doc_id`s in `config.ts` — they rotate with IG bundles)

| purpose | endpoint | friendly_name | doc_id | variables |
|---|---|---|---|---|
| chat list | `/api/graphql` | `PolarisDirectInboxQuery` | `27262915580045003` | `{device_id_for_iris_subscription, …GK flags}` + cursor |
| thread header (optional) | `/api/graphql` | `IGDInboxHeaderOffMsysQuery` | `27358538347096449` | `{thread_fbid}` |
| message history | `/api/graphql` | `IGDMessageListOffMsysQuery` | `25255103937520139` | `{id:thread_key, first:20, after?:cursor}` |
| **reel video** | `/graphql/query` | `PolarisPostActionLoadPostQueryQuery` | `8845758582119845` | `{shortcode, fetch_tagged_user_count:null, hoisted_comment_id:null, hoisted_reply_id:null}` → `data.xdt_shortcode_media.video_url` |

Request build (content script): form-encoded body = `doc_id`+`variables`+`fb_api_req_friendly_name`+`fb_api_caller_class=RelayModern`+`lsd`+`fb_dtsg`+`jazoest`+`__d=www`+`__a=1`+`__comet_req=7`+`dpr=2`+`server_timestamps=true`; headers = `x-ig-app-id:936619743392459`, `x-csrftoken`, `x-fb-lsd`, `x-fb-friendly-name`, `x-asbd-id:359341`, `content-type:application/x-www-form-urlencoded`. Threads identified by `thread_key` (passed as `thread_fbid`/`id`).

## UI (3 panes)

1. **Chat list** — sorted: pinned (local order) first, then `lastActivityMs` desc. Each row: avatar, title, last-message snippet (`slide_messages[0].igd_snippet`/`text_body`), unread dot, pin toggle. Pagination via `page_info.end_cursor`.
2. **Message history** — selected thread; reverse-chron list, oldest→newest rendered bottom→top; "load older" uses message-list `page_info.end_cursor` + `has_next_page`.
3. **Reel viewer** — clicking a `reel_share` message → RPC `getReelMedia(shortcode)` → `<video controls autoplay src={videoUrl}>` in a modal/pane. Video URL is a signed CDN link on `scontent-*.cdninstagram.com`.

## Pin (local-only)

`chrome.storage.local`: `{ pinned: string[] /* thread_keys in pin order */ }`. Sort merges local pins with server `is_pin` (local wins for ordering). Pin/unpin = UI button → background updates store → list re-sorts. No IG mutation needed.

## Manifest (WXT `wxt.config.ts`)

- `host_permissions`: `https://www.instagram.com/*`, `*://*.cdninstagram.com/*` (for `<video>`).
- `permissions`: `storage`, `tabs`.
- content script on `https://www.instagram.com/*` (`run_at: document_idle`), UI page as separate entrypoint, action click → `chrome.tabs.create({url: browser.runtime.getURL('/ui.html')})` after ensuring anchor tab.

## Milestones (build order)

1. Scaffold WXT + Svelte 5 + TS; `webext-bridge` typed message map; manifest + permissions.
2. Content script: token harvester + generic `graphql()` + `getInbox` RPC; UI renders chat list.
3. Message-history RPC + pane; exhaustive `Message` union rendering.
4. Reel-share parsing (`SlideMessagePortraitXMA` → shortcode) + reel-media RPC + inline `<video>`.
5. Pin store + list sort + pin toggle.
6. Anchor-tab lifecycle in background; token-refresh-on-401.

## Open risks / verification before each lands

- **Inbox pagination param name** (`after`? `first`?) not in the HAR — first "load more" may 400; capture a scroll-to-bottom inbox HAR if so. Message-list pagination *is* confirmed (`after`/`first`).
- **`doc_id`s rotate** with IG bundle bumps — keep in `config.ts`; verify live in DevTools when something 400s. Response key paths (`xdt_shortcode_media`, `as_ig_direct_thread`) are stable.
- **`device_id_for_iris_subscription`** must be harvested from page config (present in same `data-sjs` blob as `fb_dtsg`) — confirm key path on first run.
- Verify inline `<video>` actually plays the signed CDN URL from the extension origin (should; if blocked, add `refer`-policy or proxy via content script `fetch` → `URL.createObjectURL`).

Want me to start on milestone 1 (scaffold + typed message map + manifest), or expand any section first?
