---
# icr-xmnd
title: Integrate reply headers and timestamps into message bubbles
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T23:39:28Z
parent: icr-i2ye
blocked_by:
    - icr-gcpy
---

Unify the reply quote and message body into one bubble. The reply preview should be the top hat/section of the same surface, not a separately rounded block above it.

- [x] Place the short message time inside the bubble at bottom-right, with no dedicated timestamp row or added timestamp-only height. Reserve inline end space/widen within the available viewport instead of overlapping message text; cover short, multiline, long-word and compact layouts.
- [x] Brief hover on the time exposes a full localized date/time. Provide equivalent keyboard/focus access and a semantic time datetime value; keep history date separators and invalid-date fallbacks.
- [x] Preserve unavailable/deleted reply fallbacks and existing reply-preview semantics. This task does not add R3 reply-jump fetching/navigation.
- [x] Keep media timestamps out of normal layout; the attachment task owns their final image-overlay treatment so text-bubble widening is not imposed on media geometry.
- [x] Manually inspect outgoing/incoming, grouped replies, short/multiline/long-word content and compact layouts for clipping/collisions. Cover content, timestamp availability, fallbacks, focus and logical identity with behavior-only tests; do not assert geometry or styling.

Owners: MessageRow.tsx and styles.scss. Reply-navigation tasks still own reply navigation.

## Outcome

- Reply hat/body share one surface; text reserves inline time space while attachments keep out-of-flow time. Native hover titles and focusable semantic times expose full dates; anchored keyboard popovers dismiss on Escape/blur.
- Manual production-bundle mock review: incoming/outgoing/grouped, short/multiline/long-word, fallback and attachment cases at desktop 1100px and compact 390px/320px. Fixed the independent reviewer’s scrollport-clipping finding and rechecked the exact focus edge case. No live-account mutations or installed-extension acceptance claimed.
- Independent Pi reviewer a2c33263-60f7-4516-b5c6-f017ffbe33da approved follow-up, passed 36/36 history tests and audited behavior-only policy and focus/lifecycle cleanup.
- Fresh Bun 1.4.3: lint, all 221 tests, check, build, diff and beans checks pass. Shared scan retains only the pre-existing preferences.ts unknown-input warning: intentional external-storage validation makes that rule inapplicable. Remote CI/merge and user-live acceptance remain separate.
