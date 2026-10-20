---
# icr-xmnd
title: Integrate reply headers and timestamps into message bubbles
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:47:35Z
parent: icr-i2ye
blocked_by:
    - icr-gcpy
---

Unify the reply quote and message body into one bubble. The reply preview should be the top hat/section of the same surface, not a separately rounded block above it.

- [ ] Place the short message time inside the bubble at bottom-right, with no dedicated timestamp row or added timestamp-only height. Reserve inline end space/widen within the available viewport instead of overlapping message text; cover short, multiline, long-word and compact layouts.
- [ ] Brief hover on the time exposes a full localized date/time. Provide equivalent keyboard/focus access and a semantic time datetime value; keep history date separators and invalid-date fallbacks.
- [ ] Preserve unavailable/deleted reply fallbacks and existing reply-preview semantics. This task does not add R3 reply-jump fetching/navigation.
- [ ] Keep media timestamps out of normal layout; the attachment task owns their final image-overlay treatment so text-bubble widening is not imposed on media geometry.
- [ ] Cover outgoing/incoming, grouped replies, long content and no text/time collisions in browser geometry tests.

Owners: MessageRow.tsx and styles.scss. Reply-navigation tasks still own reply navigation.
