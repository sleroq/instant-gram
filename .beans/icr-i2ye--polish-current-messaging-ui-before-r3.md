---
# icr-i2ye
title: Polish current messaging UI before R3
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - ui-polish
    - ux
created_at: 2026-10-20T19:27:49Z
updated_at: 2026-10-20T19:51:41Z
blocking:
    - icr-jce7
    - icr-9ib2
blocked_by:
    - icr-uizd
---

Polish the accepted R2 Solid messaging UI before starting R3. This is presentation work plus the smallest worker-owned read-recovery/current-coverage changes needed for the approved UX. Pull forward one shared settings/motion owner; do not rebuild the backend, add UI polling, or introduce media playback.

Child beans are the implementation authority. Sender/time grouping owns text/share proximity; its follow-up must verify the result before inventing another heuristic. Pin/unpin remains available until the R3 conversation menus replace its header control. Existing-data attachment presentation is pulled forward from R4; full media resources and player behavior remain R4.

Completion requires all polish children completed or explicitly resolved, the confirmed automatic-first recovery and newest-follow behavior implemented, focused accessible browser coverage, preserved logical anchors and bottom-follow, at most 31 fixed 72px inbox rows and 80 history rows, and the normal frontend quality gate. Animations must honor system reduced motion. Physical sidebar reorder sliding is approved under icr-f00w while fixed outer virtual slots, row/mount bounds and anchors remain correct; other placement/layout and maintenance scrolling remain unanimated.

## Delivery children

- [ ] icr-4rev — Replace freshness status text with accessible sync orbs
- [ ] icr-yqp8 — Float the composer and send control as two rounded clouds
- [ ] icr-mrxb — Float the conversation title above the message history
- [ ] icr-gcpy — Group nearby messages and preserve the incoming avatar gutter
- [ ] icr-xmnd — Integrate reply headers and timestamps into message bubbles
- [ ] icr-83kg — Replace the Reply text button with a contextual circular icon
- [ ] icr-mvlx — Render existing media previews as media-only aspect-aware attachments
- [ ] icr-omoc — Hide the sidebar resize strip without shrinking its hit target
- [ ] icr-7h98 — Retry reads automatically before exposing recovery controls
- [ ] icr-8yrw — Recheck adjacent text and shared-media grouping after spacing polish

## Deferred follow-through

- R3 menus: icr-u9ok; R3-only Pin/Unpin migration: icr-7zgg.
- Existing-data preview presentation: icr-mvlx; remaining media resources/player work stays icr-iwr9.
- icr-7h98 is now todo: the user confirmed automatic-first recovery, then manual controls. icr-j8fk removes the old Show latest messages interaction safely.
- Exact unread counts/preloading (icr-sphm), reply-return behavior (icr-zoba) and future reaction/menu motion (icr-dtee) are deferred linked work, not reasons to stall current presentation polish. Configuration choices belong to icr-r54z when settings design begins; speculative cache task icr-li1d is merged there.

## Additional current-polish children

- [ ] icr-r54z — Build a settings page with one shared preference and motion owner
- [ ] icr-yp9o — Fold the conversation sidebar into an accessible icons-only rail
- [ ] icr-0c4s — Animate new incoming and outgoing messages at the chat tail
- [ ] icr-f00w — Animate sidebar reorder and pin changes with physical sliding
- [ ] icr-j8fk — Automatically adopt newest history at the logical chat bottom
- [ ] icr-mwu8 — Add a floating newest button with a new-message badge

The user approved physical sidebar reorder sliding; icr-f00w is todo with a narrow presentation-motion exception, not a pending decision. Tail entrance and sidebar motion share the motion gate; maintenance scrolling and layout geometry remain immediate. Unread numeric totals remain separate from the basic per-window new-message badge.
