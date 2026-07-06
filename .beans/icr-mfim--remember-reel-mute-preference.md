---
# icr-mfim
title: Remember reel mute preference
status: todo
type: feature
tags:
    - player
    - reels
    - ux
created_at: 2026-07-04T16:40:02Z
updated_at: 2026-07-04T16:40:02Z
parent: icr-0tpu
---

Remember whether reels should open muted or unmuted instead of always forcing muted playback.

Checklist:

- [ ] Add persisted player audio preference storage.
- [ ] Initialize new reel modals from the saved mute/unmute preference.
- [ ] Update the preference when the user changes mute state in the player.
- [ ] Verify the preference survives reopening the popup/extension UI.
