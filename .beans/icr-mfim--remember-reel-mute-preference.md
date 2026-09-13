---
# icr-mfim
title: Remember reel mute preference
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

Remember whether reels should open muted or unmuted instead of always forcing muted playback.

Checklist:

- [ ] Add persisted player audio preference storage.
- [ ] Initialize new reel modals from the saved mute/unmute preference.
- [ ] Update the preference when the user changes mute state in the player.
- [ ] Verify the preference survives reopening the popup/extension UI.



## Solid restoration handoff (2026-09-13)

Restore only when R4.15 introduces the first persistent player preference. Use the single global `storage.local` settings service with cross-client updates; do not use page localStorage or create a temporary media authority.
