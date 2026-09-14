---
# icr-yvm4
title: Make unavailable shares an intentional card state
status: completed
type: bug
priority: normal
tags:
    - browser
    - media
    - ux
    - solid-restoration
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-09-13T13:24:17Z
parent: icr-siiy
---

## Browser finding (2026-08-03)

Unavailable shares render as generic “Instagram share / Message unavailable”, which reads as a broken card rather than an intentional unavailable state. `parseMessage()` already detects `SlideMessagePlaceholderXMA` and assigns “Unavailable attachment”.

## Scope

Render that known unavailable-share state with a subdued, reserved-geometry unavailable card/icon and clear accessible label. Do not attempt to fetch missing media or treat unavailable content as a runtime error.



## Solid restoration handoff (2026-09-13)

This is now R1.21 under `icr-siiy`. Implement the retained normalized unavailable fact and accessible Solid card without media retries, retired components, or a parallel cache.
