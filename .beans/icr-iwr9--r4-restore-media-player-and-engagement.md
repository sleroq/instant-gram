---
# icr-iwr9
title: 'R4: Restore media, player, and engagement'
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - media
    - engagement
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-10-20T19:49:38Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-uizd
---

Deliver normalized media resources, accessible player, comments and durable engagement using the existing persistence and outbox. Components receive domain projections; metadata retention and reads stay worker-owned.

icr-mvlx owns existing-history preview geometry and its 300×300 envelope. Integrate that surface without duplicating its markup/CSS. Player controls and mute preferences are tracked through icr-0tpu and its children; use icr-r54z for shared global settings.

Acceptance includes geometry, cleanup races, account/resource isolation, optimistic rollback, player state, bounded comments and the repository quality gate.

## Task-owned acceptance

- [ ] **Normalize metadata.** Store media, users, comments, and query records by IDs; map shortcode-to-media identity. Persist metadata only—never media bytes or avatar data URLs.
- [ ] **Closed media protocol.** Use current captured REST media-info and shortcode lookup evidence with shared parsers. Components receive domain data, never raw document IDs or protocol payloads.
- [ ] **Account/resource retention.** Media facts participate in R1 references, so inbox/history refresh cannot erase still-used metadata.
- [ ] **Lazy route code and read scheduling.** Load the route chunk on intent. The starting budget is 2 concurrent media reads, 2 likely-chat warmups, 1 adjacent older-history page, and 4 queued reply targets processed serially at one page each. Measure a worker-lifetime/interest budget for speculative starts separately from concurrency; never limit visible or explicit intent by that budget. Pull chat/history warmups into the R1/R2 read scheduler when relevant rather than waiting for the media phase.
- [ ] **Safe avatars.** Reintroduce fetch/proxy support only when needed, with HTTPS, 2 MiB maximum, no redirects, exact CDN permission, and disposable object/data URLs that are never persisted.
- [ ] **Intentional unavailable card.** Give unavailable shares accessible retained metadata and no repeated fetch.
- [ ] **Accessible modal.** Trap/restore focus, inert the background, lock scroll, close outside/on Escape, and use aspect-aware desktop presentation plus a compact full-screen sheet.
- [ ] **Player basics.** An explicitly opened new modal item may begin playback when the browser permits; an item explicitly paused earlier remains paused. Support play/pause, blocked-playback reporting, seek, time, and fullscreen with native media semantics.
- [ ] **Variant quality.** Switching quality preserves current time, playback rate, volume/mute, and play intent.
- [ ] **Carousel isolation.** Keep independent per-item state; forced muting of a slide video must not overwrite the user's global preference.
- [ ] **Player gestures/keys.** Distinguish Space/tap from a 250 ms 2× hold with cleanup; support comma/period one-frame stepping (1/30 fallback) and arrows without leaking into global shortcuts.
- [ ] **Controls visibility.** Keep controls visible with focus; otherwise treat an initial 10 s idle / 1.5 s pointer-leave policy as a starting point, not a measured SLA.
- [ ] **State authority.** Playback position/paused state is per window. Global volume/mute uses one `storage.local` service and only adds permission when that persistence ships.
- [ ] **Attached audio/music.** Render title/artist/offsets; keep the soundtrack across slides, pause it on close, force slide-video mute without changing user preference, and report blocked playback.
- [ ] **Signed URL refresh.** Keep modal/metadata mounted while the worker performs one forced shared refresh; show explicit Retry on failure.
- [ ] **Safe export.** Carry the parser-provided `targetUrl` in the open intent for Copy. Download only when actual parser fields establish signed-CDN URL eligibility. Never invent a `shareURL` contract or download endpoint.
- [ ] **Lazy comments.** Start only after modal open/media ready. Preserve exact top-level and child cursors and explicit server pagination.
- [ ] **Comment budget.** Choose and test a mounted-comment budget before shipping; do not assume the history 80-row limit applies to comments.
- [ ] **Like/save/comment reactions.** Route media like/save and comment like/unlike through the durable outbox with strict receipt identity.
- [ ] **Create/reply comments.** Enforce the 2200-character limit and persist every accepted intent. Known success reconciles receipt, entity, and parent. Because there is no proven reliable client key for this non-idempotent action, mark only lost/uncertain outcomes `outcome_unknown` and never blindly replay them.
- [ ] **Social cue integrity.** Show at most five named likers only with proof they are viewer-followed; optional ranked-comment same-author cues are allowed. Never infer arbitrary “friends.”

Preserve thumbnails until playable content is ready. Integrate compact author, external reaction and hover/focus time treatment within the preview limits owned by icr-mvlx.
