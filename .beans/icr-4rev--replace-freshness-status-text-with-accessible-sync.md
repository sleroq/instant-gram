---
# icr-4rev
title: Replace freshness status text with one accessible sync orb
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-21T07:09:44Z
parent: icr-i2ye
blocked_by:
    - icr-r54z
---

Replace the sidebar Up to date/Refreshing/cached paragraph and conversation header Showing retained history paragraph with one shared sync orb in the persistent application rail. Per final user refinement, use one lava-lamp gradient without a center dot or changing glyphs. Keep the distinct blue/gold/red state palettes and eased color changes. Summarize the inbox and selected history while describing each resource independently.

- [x] Project the existing worker-owned availability, freshness, synchronization and error states; distinguish initial loading, queued/refreshing, fresh idle, stale/retained and failed/unavailable states. Do not infer contiguous/newest coverage from retained facts.
- [x] Use one glyph-free gradient orb without a center dot: blue for fresh, gold for loading/refreshing/retained, red for failed/unavailable. Keep subtle lava-lamp motion and eased palette changes. Accessible names and readable hover/focus descriptions explain state without relying on color. Honor shared Animations On/Off and live OS/user updates; Off applies the current state immediately without decorative motion.
- [x] Remove the persistent visible status paragraphs, not actionable errors or failure detail. Avoid layout shifts and repetitive screen-reader announcements on each poll.
- [x] Cover semantic state transitions, keyboard/focus descriptions and cleanup without adding UI polling or a second freshness store. Review appearance and motion manually; do not automate visual/design assertions.

Owners: App.tsx, SyncOrb.tsx, InboxList.tsx, ConversationPane.tsx and styles.scss. Global cross-pane errors remain under icr-jce7; consume the shared shell motion gate.

## Shared motion/settings integration

icr-r54z is now the single shared preference/motion owner, pulled forward into current polish. The orb must consume that effective motion gate (including live OS/user changes) rather than adding an independent persisted animation switch. Automatic-first recovery is now confirmed in icr-7h98.

## Implementation and verification

- One persistent orb replaces both paragraphs; errors, Retry and Refresh controls remain. The most urgent inbox/selected-history state determines the orb's summary; the description keeps resource identity and the retained-coverage caveat. Unselected warm histories do not determine current sync status.
- Shared shell motion gate only; no added preference owner, polling or freshness resource. Hover/focus descriptions support Escape and immediate blur cleanup, including navigation to Settings.
- Manual isolated mocked-Port review at desktop, 390px and 320px: gradients, hover path, descriptions, error controls and layout; stronger blue/gold/red palettes, intermediate state colors and immediate static Off behavior checked. Final dot removal manually rechecked on desktop/compact fixtures; gradients, state transitions and static Off behavior remain intact. No real account mutations, installed-extension or assistive-technology acceptance claimed.
- Fresh Bun 1.4.3 gates: lint, all 220 tests across 26 files, check, build, diff check, beans check and shared scan passed. The scan's existing `preferences.ts` unknown-input warning is inapplicable: this is the external storage parsing boundary.
- Independent Pi review `6a2ae13c-b8b3-4a96-8093-ebb34fa9ed7d`: no blocking findings after final dot removal; deletion cleanup, unchanged state/accessibility/motion semantics and behavior-only test policy checked. Full suite and manual appearance were not independently rerun; manual appearance evidence is implementation-side. Parent milestone and live/merged acceptance remain open.
