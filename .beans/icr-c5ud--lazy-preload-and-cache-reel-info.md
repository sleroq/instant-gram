---
# icr-c5ud
title: Preload visible shared-post media
status: completed
type: feature
priority: high
tags:
    - history
    - comments
    - discovered
    - player
    - reels
    - performance
created_at: 2026-07-04T16:40:02Z
updated_at: 2026-08-06T15:07:19Z
parent: icr-61iz
---

Finish the store-owned media readiness path for shared posts so a user opening a post finds reel metadata/video already loaded or explicitly queued. Keep comments lazy: request the initial comment page only after an explicit post open, as the current architecture documents.

Current state: store.ts already deduplicates and warms reel media from loaded history pages (max two active requests and eight starts per store lifetime), and openReel waits for an overlapping media request. Inline preview videos autoplay when near the viewport.

Scope:

- Disable inline history video autoplay. Previews may decode/load metadata or a poster, but video playback begins only after explicit user action in the opened post/player.
- Extend the existing normalized ReelState/store preload scheduler rather than creating component caches. Prioritize visible/near-visible or otherwise selected post candidates while retaining bounded concurrency and lifetime budgets.
- Deduplicate against active/open media requests and retain the existing cache on retry/error. An opening post must await an overlapping preload rather than duplicate it.
- Keep comments lazy; do not alter getReelComments scheduling or cache semantics.
- Preserve stale-generation checks, modal-close semantics, the 80-row history cap, and anchored viewport behavior.
- Add focused store tests for media queue deduplication, priorities, and explicit-open overlap; add browser coverage that previews remain paused and an already-ready post opens without a duplicate media request.

Acceptance: history videos never begin playing autonomously; visible/near-visible posts have media loaded or a clearly bounded queued task before click; comments remain lazy until explicit open; explicit open never starts duplicate media RPCs; failures expose the established retry state and do not poison later opens.

Completed 2026-08-06: inline previews remain paused, visible/near-visible shares prioritize the existing bounded normalized preload queue, opens join active media flights, and comments remain explicit-open lazy. Added store priority/dedup/open-overlap coverage and browser readiness/playback coverage.
