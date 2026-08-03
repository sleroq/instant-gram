---
# icr-yvm4
title: Make unavailable shares an intentional card state
status: todo
type: bug
priority: normal
tags:
    - browser
    - media
    - ux
created_at: 2026-08-03T13:17:25Z
updated_at: 2026-08-03T13:17:25Z
---

## Browser finding (2026-08-03)

Unavailable shares render as generic “Instagram share / Message unavailable”, which reads as a broken card rather than an intentional unavailable state. `parseMessage()` already detects `SlideMessagePlaceholderXMA` and assigns “Unavailable attachment”.

## Scope

Render that known unavailable-share state with a subdued, reserved-geometry unavailable card/icon and clear accessible label. Do not attempt to fetch missing media or treat unavailable content as a runtime error.
