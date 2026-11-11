---
# icr-j8fk
title: Automatically adopt newest history at the logical chat bottom
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T23:40:48Z
parent: icr-i2ye
blocked_by:
    - icr-yqp8
---

Remove the textual Show latest messages coverage-switch control. The user expects new/current messages to load automatically when genuinely following the chat bottom, while an older-reading position must not jump.

- [x] Reuse worker-owned load-newer-history/current-head adoption. DOM-bottom of an 80-row slice, 400-ID projection or previous generation alone is not proof of the newest chat tail. Preserve explicit bottom-follow intent across incoming head changes and traverse cached newer coverage before selecting the current head as appropriate.
- [x] If the user was following newest, adopt newly refreshed current coverage automatically with a bounded latest window. While reading older messages or a reply target, preserve the exact logical anchor; a floating down/return action can express explicit navigation intent.
- [x] Remove the old text button, not newerCoverageAvailable, cachedNewer, previous-generation evidence or cursor-linkage checks. Never concatenate detached ranges to fabricate continuity or mark unseen arrivals read.
- [x] Share bottom-clearance measurements with floating composer icr-yqp8. Distinguish a deliberate request to reach newest from ordinary window recycling, short-viewport fill and merely reaching a stale slice edge.
- [x] Replace the browser test requiring the old Show latest interaction with genuine-tail auto-adoption and older-anchor preservation coverage, including disjoint heads and incoming updates.

Owners: ConversationPane.tsx and the existing worker history-selection boundary as needed. This intentionally changes the approved UX, not the rule that retained facts do not prove contiguous coverage.

## Implementation and verification

- Removed the text coverage switch. Proven newest-follow intent survives incoming heads and per-thread/remount restoration; deliberate keyboard, wheel and single-finger forward traversal consumes cached newer ranges before detached current adoption. Maintenance scrolling, short fill and zoom gestures do not create newest intent.
- Kept worker selection/cursor/previous-generation evidence unchanged, exact older anchors/focus, measured composer clearance and send/draft/alias behavior. Synchronous local request tokens prevent duplicate commands during Solid batching.
- Fresh Bun 1.4.3 gates passed: lint, test (227 tests, including 42 history browser cases), check, build, diff check, beans check and shared ast-grep scan. The sole preexisting scan warning is the validated external-storage parser in preferences.ts; its unknown input is appropriate at that boundary.
- Independent Pi reviewer 27ed6e64-5ebd-4e7d-a4d9-4206e98b6509 approved follow-ups, including behavior-only test audit and independent zoom/remount probes. Its confirmed Ctrl+wheel finding was fixed and regression-tested.
- Manually inspected safe mocked-Port desktop 1100 and compact 390 fixtures, including detached adoption, older-reader refresh and responsive remount. Newest content remains above the measured composer. Screenshots are manual evidence only, not automated design assertions. No live-account or installed-extension verification, real mutations, merge or user acceptance claimed.
