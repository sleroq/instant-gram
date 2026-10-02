---
# icr-lb3r
title: Make chat sidebar horizontally resizable
status: completed
type: feature
priority: normal
tags:
    - solid-restoration
    - ui
created_at: 2026-08-06T14:48:42Z
updated_at: 2026-09-13T12:05:14Z
parent: icr-siiy
---

Replace the current non-resizable sidebar behavior with horizontal width resizing, using Ajaxy/telegram-tt as a behavioral reference: https://github.com/Ajaxy/telegram-tt.

The prior sidebar-resize bean `icr-w5fx` was scrapped under an earlier non-resizable product decision; this task supersedes that decision.

Acceptance criteria:

- Provide an accessible horizontal resize handle for the chat sidebar.
- Resize smoothly with sensible minimum and maximum widths without disrupting chat-list virtualization or the active chat layout.
- Preserve the selected width across reloads if that matches the referenced product behavior and existing persistence patterns.
- Support pointer and keyboard interaction, reduced-motion preferences, and narrow viewports.
- Update the relevant frontend architecture/product documentation and add focused coverage for the resize state and interaction boundary.

Implementation completed:

- Added a semantic desktop separator with pointer capture, keyboard arrows/Home/End, visible focus, double-click reset, and direct non-animated width updates.
- Added pure 280–520px responsive bounds that reserve a 320px conversation, hide the handle at 640px and below, and preserve the fixed 72px virtualized inbox geometry.
- Persisted the validated presentation preference under `icr:sidebar-width`; temporary viewport clamping does not overwrite it.
- Documented the clean-room review of pinned Telegram Web A resize behavior and the independent ICR adaptation.
- Added focused pure and production-browser coverage for bounds, invalid persistence values, pointer/keyboard interaction, reload persistence, compact layout, and virtualization invariants.

Verification: focused resize browser tests and pure tests pass; `npm run check`, `npm run build`, and `git diff --check` pass. Full `npm test` ran 140 tests: 137 passed; three failures are in unrelated in-progress reel/reaction work (exact 300px floating-point assertion, reaction picker behavior) plus the former intermediate non-resizable assertion, which was updated and now passes in the focused run.

Final verification supersedes the earlier in-progress run: all 140 `npm test` tests pass after integrating the updated intermediate-layout assertion. `npm run check`, `npm run build`, and `git diff --check` also pass.

Critical-review follow-up hardened denied preference storage, independently
reactive ARIA bounds, and idempotent pointer-capture/unmount cleanup. Browser
coverage now uses 60 threads at a nonzero virtual scroll window, proves retained
row identity and geometry through pointer resize, checks pointer persistence
before remount, and verifies temporary viewport clamping restores the preferred
width. The focused resize/storage tests, typecheck, production build,
`git diff --check`, and `beans check` pass. The full 143-test run passed 142 and
hit an unrelated timing-sensitive reply-prefetch retry timeout; that exact test
passes when rerun alone. All sidebar acceptance criteria pass, so this bean
remains completed.

## Solid restoration handoff (2026-09-13)

This completion records retired behavior. R1.12 under `icr-siiy` owns the Solid restoration; width is initially window-local and persistence waits for the single global settings service.
