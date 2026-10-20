---
# icr-mvlx
title: Render existing media previews as media-only aspect-aware attachments
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:48:02Z
parent: icr-i2ye
blocked_by:
    - icr-xmnd
---

Replace the current 54px square thumbnail-plus-label cards with attachment-sized, media-forward previews for reels, posts, inline shares and image messages, using only currently available normalized history data.

- [ ] Remove visible generated Shared a reel/post and equivalent card-title/type/summary chrome when media is available: show the media itself, with an accessible link/image name. Do not delete separately sent user text or domain metadata. Caption/title metadata can remain available to assistive descriptions rather than a repeated visible preview label.
- [ ] Use reel previewWidth/previewHeight and image dimensions when provided; preserve portrait, landscape and square ratios without forced square crops or distortion. Reserve known geometry within the 300x300 envelope and compact available width. For missing dimensions use an honest thumbnail fallback; any intrinsic-image size correction must preserve the logical anchor.
- [ ] Keep the timestamp as a bottom-right overlay without increasing attachment height; preserve R4's media hover/focus treatment rather than applying text-bubble inline spacing.
- [ ] Preserve existing safe external-open behavior and intentional accessible unavailable/unsupported fallback cards. Media-only does not mean a blank inaccessible link when the media is missing.
- [ ] Cover delayed image loading, known/missing dimensions, several ratios, narrow layouts and anchor correction; never autoplay inline previews.

Owners: MessageRow.tsx and styles.scss. This pulls forward only the presentation scope for existing attachments and supersedes the current tiny-card design. Media-info reads, normalized media resources, proxying, playback, carousels and comments remain under icr-iwr9; do not introduce them to obtain prettier thumbnails.
