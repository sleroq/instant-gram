---
# icr-yqp8
title: Float the composer and send control as two rounded clouds
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:47:14Z
parent: icr-i2ye
---

Replace the full-width blocky composer with an input pill/cloud and a separate circular rounded Send control floating over the message viewport. Remove the visible Message label, retaining the textarea accessible name.

- [ ] Keep newest messages entirely above the complete composer footprint when at bottom. While scrolling older messages, content may pass behind the floating controls; do not create a permanent opaque footer bar.
- [ ] Account for multiline growth, reply context, validation/errors, narrow screens and viewport changes when measuring bottom clearance. Preserve logical ID-plus-offset anchors and existing follow-bottom decisions, including incoming messages, sends, prepends and thread switches.
- [ ] Preserve drafts, durable acceptance semantics, Enter/Shift+Enter/IME, send eligibility, reply cancellation and accessible controls. No protocol, outbox or draft-ownership changes.
- [ ] Add production-browser geometry and interaction coverage; retain the 80-message DOM bound and immediate, non-animated anchor correction.

Owners: Composer.tsx, ConversationPane.tsx, history-viewport.ts only if required, styles.scss.
