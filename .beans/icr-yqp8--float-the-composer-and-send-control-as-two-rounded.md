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
updated_at: 2026-10-20T21:02:52Z
parent: icr-i2ye
---

Replace the full-width blocky composer with an input pill/cloud and a separate circular rounded Send control floating over the message viewport. Remove the visible Message label, retaining the textarea accessible name.

- [x] Keep newest messages entirely above the complete composer footprint when at bottom. While scrolling older messages, content may pass behind the floating controls; do not create a permanent opaque footer bar.
- [x] Account for multiline growth, reply context, validation/errors, narrow screens and viewport changes when measuring bottom clearance. Preserve logical ID-plus-offset anchors and existing follow-bottom decisions, including incoming messages, sends, prepends and thread switches.
- [x] Preserve drafts, durable acceptance semantics, Enter/Shift+Enter/IME, send eligibility, reply cancellation and accessible controls. No protocol, outbox or draft-ownership changes.
- [x] Add production-browser behavior coverage for drafts, replies, sends and logical message restoration; retain the 80-message DOM bound and immediate anchor correction. Review shape, full bottom clearance and scrolled-up overlays manually. Follow tests/AGENTS.md: no automated geometry, style or screenshot assertions; geometry may only drive scrolling or identify visible messages.

Owners: Composer.tsx, ConversationPane.tsx, history-viewport.ts only if required, styles.scss.

## Implementation evidence (replacement on d4a12bc)

- Composer is an absolute transparent overlay containing a rounded input cloud and a separate circular, accessible Send button. Textarea keeps the Message accessible name; no visible title. CSS content sizing grows multiline text within a viewport-relative cap.
- A disposed-with-owner ResizeObserver measures the entire form, including reply/error content and outer insets. The history controller reserves that footprint as tail padding. Corrections retain prior bottom-follow intent or the older reader's logical anchor; no animation or newer-coverage adoption was added. App draft/version guards and submit ownership are unchanged.
- Fresh Bun 1.4.3 verification: frozen install, lint, isolated `bun run test` (190 passing), TypeScript check, production build, diff check and beans check passed. Shared ast-grep scan is clean after separating new test cases into coherent phases. Final gates were repeated after independent review with the same results.
- Behavior-only browser coverage adds logical message identity through draft/reply growth, rejection, send acceptance, arrival/prepend, resize and thread restoration, plus mount bounds; expands whitespace/validation/newline/reply-cancel checks. Existing IME and accepted-version coverage remains. No geometry/design/screenshot assertions were added.
- Manually inspected mocked-Port Chromium screenshots: 1100×700 empty composer, four-line draft/reply, storage rejection; 390×550 compact draft/reply and older-reader overlay; 320×480 long wrapping reply and over-limit validation. Checked separate rounded shapes, no visible label, full newest-row clearance at bottom, and older content behind controls rather than an opaque footer. Temporary screenshots are review evidence, not golden tests.
- Evidence limit: mocked Ports, not live Instagram or installed-extension acceptance. Parent milestone is not completed. Independent reviewer: Pi/OpenAI Codex `1e6ac618-96cf-4843-baf2-6e640d923a5f` (`openai-codex/gpt-6.1-sol`, high reasoning): no concrete findings. Reviewed correctness, Solid lifecycle, accessibility/focus, scroll/follow contracts, scope and behavior-only test compliance; independently ran both affected browser suites (22 passed), checked the diff and inspected compact screenshots. No tracked files were edited by the reviewer.
