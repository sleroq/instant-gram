---
# icr-tniw
title: Add scroll-controlled reel volume and speed
status: todo
type: feature
priority: normal
tags:
    - player
    - reels
    - ux
    - solid-restoration
created_at: 2026-07-04T16:40:02Z
updated_at: 2026-09-13T12:04:44Z
parent: icr-0tpu
---

Add scroll-controlled buttons/controls for audio volume and playback speed in the reel player.

Checklist:

- [ ] Design volume and playback-speed controls that support wheel/scroll adjustment.
- [ ] Wire volume changes to the video element and update mute state consistently.
- [ ] Wire playback-rate changes to the video element with sensible bounds/steps.
- [ ] Show current volume and speed values in the UI.
- [ ] Verify scroll interaction does not accidentally scroll the modal/page.

## Solid restoration handoff (2026-09-13)

This is optional R5.5, not part of baseline R4 player restoration. Ship only with a discoverable opt-in or explicit control target that cannot hijack page scroll; otherwise scrap the gesture proposal.
