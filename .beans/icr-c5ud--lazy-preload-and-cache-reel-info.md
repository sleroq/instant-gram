---
# icr-c5ud
title: Lazy preload and cache reel info
status: todo
type: feature
tags:
    - player
    - reels
    - performance
created_at: 2026-07-04T16:40:02Z
updated_at: 2026-07-04T16:40:02Z
parent: icr-0tpu
---

Lazy-preload and cache reel info so opening a reel does not always trigger a fresh dynamic load.

Checklist:
- [ ] Add an in-memory cache keyed by media id or shortcode for reel metadata/video URL responses.
- [ ] Lazy-preload visible or near-visible reel shares without blocking chat rendering.
- [ ] Reuse cached reel info when opening a reel.
- [ ] Add cache invalidation/expiry appropriate for Instagram signed media URLs.
- [ ] Verify repeated opens avoid duplicate reel-info requests while stale URLs can refresh.
