---
# icr-yp9o
title: Fold the conversation sidebar into an accessible icons-only rail
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T23:36:19Z
parent: icr-i2ye
blocked_by:
    - icr-omoc
---

Add an explicit collapse/expand action for the existing conversation sidebar. Collapsed mode shows conversation icons/avatars rather than full row text; this is not a generic multi-destination navigation rail.

- [x] Keep selected-conversation indication, accessible conversation names/tooltips, keyboard navigation, future unread badges and compact-screen Back behavior usable in both modes.
- [x] Preserve fixed 72px inbox slots and at most 31 mounted rows. Switching modes must retain logical list position/focus and the selected chat's draft/history anchor without resubscribing or remounting history unnecessarily.
- [x] Preserve the expanded resize width and valid min/max bounds; collapsed mode must coexist with the invisible separator from icr-omoc. Do not animate virtual row placement or layout.
- [x] Keep geometry window-local unless a persistence choice is explicitly added through icr-r54z; do not introduce a second preference store.
- [x] Cover fold/unfold, selection, resize, keyboard, long labels and desktop/compact transitions.

## Implementation and verification

- Added in-place desktop folding with retained initials, accessible names/descriptions/tooltips, selection and unread slots. Compact keeps the full inbox/Back flow and restores folding on desktop.
- Fold and preferred expanded width stay in window-local App signals across tab/compact transitions. Folding ends active resize capture/listeners without replacing inbox/history or changing route, drafts, subscriptions or motion ownership.
- Behavior-only browser coverage verifies actions/semantics, logical list/message and mounted-node identity, focus, drafts, tab routing, keyboard selection, resize cleanup/retention and 31/80-row bounds. No appearance-contract assertions.
- Bun 1.4.3: lint, all 220 tests, typecheck, build, diff check and `beans check` passed. Shared scan has only the pre-existing `preferences.ts:6` warning: `parseAnimations` intentionally validates unknown external storage input at that boundary; no suppression or unrelated rewrite.
- Manually reviewed safe mocked Chromium screenshots at desktop/narrow/compact sizes: expanded/icons-only, long names, selected/unread/focus cues, resize focus, failure/continuation Retry and compact Back. No live-account, installed-extension, screen-reader or native OS tooltip verification claimed.
- Independent Pi review `c4f9b5ae-f260-448a-8424-e4772a26f0a7`: no actionable findings; test-policy audit passed. Reviewer independently reran 35 history tests, lint/typecheck/diff/scan and reviewed the full-suite log/manual evidence. Implementation complete; merge/user-live acceptance remains external.
