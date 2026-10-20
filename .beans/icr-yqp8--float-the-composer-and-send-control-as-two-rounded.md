---
# icr-yqp8
title: Float the composer and send control as two rounded clouds
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T20:15:13Z
parent: icr-i2ye
---

Replace the full-width blocky composer with an input pill/cloud and a separate circular rounded Send control floating over the message viewport. Remove the visible Message label, retaining the textarea accessible name.

- [x] Keep newest messages entirely above the complete composer footprint when at bottom. While scrolling older messages, content may pass behind the floating controls; do not create a permanent opaque footer bar.
- [x] Account for multiline growth, reply context, validation/errors, narrow screens and viewport changes when measuring bottom clearance. Preserve logical ID-plus-offset anchors and existing follow-bottom decisions, including incoming messages, sends, prepends and thread switches.
- [x] Preserve drafts, durable acceptance semantics, Enter/Shift+Enter/IME, send eligibility, reply cancellation and accessible controls. No protocol, outbox or draft-ownership changes.
- [x] Add production-browser geometry and interaction coverage; retain the 80-message DOM bound and immediate, non-animated anchor correction.

Owners: Composer.tsx, ConversationPane.tsx, history-viewport.ts only if required, styles.scss.

## Implementation and evidence

- Added separate floating input and circular Send clouds, preserving the accessible Message name and existing draft/submission ownership.
- Measured the entire form, including multiline input, reply and errors; shared clearance drives bottom padding and keyboard scroll padding without an opaque footer.
- Preserved ID-plus-offset anchors and immediate size correction. Local bottom-tail metadata survives responsive remounts only while the same tail remains current; inactive-thread arrivals do not force latest adoption.
- Added production Chromium regressions for complete clearance, rejection/acceptance, compact/short viewports, keyboard focus visibility, older-reader anchors, prepends, arrivals and thread switches. Existing IME/newline/draft-version tests and the 80-row bound pass.
- Independent reviewer `/root/composer_review` found two issues (obscured keyboard focus and lost bottom intent on compact remount). Both were fixed and independently reproduced as resolved. Final independent history/R2 run: 29 passed, 0 failed; no unresolved findings.
- Final verification: `bun run lint`, `bun run test` (197 passed across 25 files), `bun run check`, `bun run build`, `git diff --check`, `beans check`, and the shared `ast-grep` scan passed with no scan findings.
- Browser evidence uses mocked extension Ports and safe fixtures. No live-account validation or authenticated mutations were performed. Implementation is ready for PR review; merge and user acceptance remain separate.
