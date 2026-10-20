---
# icr-1xh8
title: Build a custom reel player
status: todo
type: feature
priority: high
tags:
    - player
    - reels
    - ux
    - solid-restoration
created_at: 2026-07-04T16:40:02Z
updated_at: 2026-10-20T19:47:50Z
parent: icr-0tpu
---

Implement a custom in-app reel player instead of relying on the browser default video controls.

Checklist:

- [ ] Define the player control layout and interaction states for loading, error, playing, paused, and ended.
- [ ] Replace default `<video controls>` usage with custom controls around the video element.
- [ ] Preserve keyboard and pointer interactions for play/pause, seek, close, and focus handling.
- [ ] Verify reel playback still works with existing reel-info loading flow.

## Delivery constraints

Deliver player behavior through `icr-iwr9`, with media facts in the worker and playback/DOM state local to Solid.
