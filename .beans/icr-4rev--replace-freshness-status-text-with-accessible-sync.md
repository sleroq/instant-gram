---
# icr-4rev
title: Replace freshness status text with accessible sync orbs
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T23:38:18Z
parent: icr-i2ye
blocked_by:
    - icr-r54z
---

Replace the sidebar Up to date/Refreshing/cached status text and the conversation header Showing retained history text with compact state orbs. The retained-history text is actually in ConversationPane.tsx, not the sidebar; cover both locations without conflating their resources.

- [x] Project the existing worker-owned availability, freshness, synchronization and error states; distinguish initial loading, queued/refreshing, fresh idle, stale/retained and failed/unavailable states. Do not infer contiguous/newest coverage from retained facts.
- [x] Communicate status through color and appropriate animation, with accessible names, a readable hover/focus description and a non-color-only alternative. Honor prefers-reduced-motion without losing state information.
- [x] Remove the persistent visible status paragraphs, not actionable errors or failure detail. Avoid layout shifts and repetitive screen-reader announcements on each poll.
- [x] Cover semantic state transitions, keyboard/focus descriptions and cleanup without adding UI polling or a second freshness store. Review appearance and motion manually; do not automate visual/design assertions.

Owners: InboxList.tsx, ConversationPane.tsx, SyncOrb.tsx and styles.scss. Global cross-pane errors remain under icr-jce7; consume the shared shell motion gate.

## Shared motion/settings integration

icr-r54z is now the single shared preference/motion owner, pulled forward into current polish. Orbs must consume that effective motion gate (including live OS/user changes) rather than adding an independent persisted animation switch. Automatic-first recovery is now confirmed in icr-7h98.

## Implementation and verification

- Independent resource orbs replace both persistent paragraphs; errors, Retry and Refresh controls remain. Retained history does not imply current/complete coverage.
- Shared shell motion gate only; no added preference owner, polling or freshness resource. Hover/focus descriptions support Escape and dispose with the pane.
- Manual isolated mocked-Port review at desktop, 390px and 320px: state symbols, long-title hover access, readable descriptions, error controls and layout; On/Off and live OS/storage changes checked. No real account mutations, installed-extension or assistive-technology acceptance claimed.
- Fresh Bun 1.4.3 gates: lint, all 220 tests across 26 files, check, build, diff check, beans check and shared scan passed. The scan's existing `preferences.ts` unknown-input warning is inapplicable: this is the external storage parsing boundary.
- Independent Pi review `6a2ae13c-b8b3-4a96-8093-ebb34fa9ed7d`: hover-path finding fixed and rechecked at all three sizes; no remaining blocking findings. Behavior-only test policy independently audited. Parent milestone and live/merged acceptance remain open.
