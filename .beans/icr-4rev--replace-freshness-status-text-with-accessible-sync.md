---
# icr-4rev
title: Replace freshness status text with accessible sync orbs
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:48:02Z
parent: icr-i2ye
blocked_by:
    - icr-r54z
---

Replace the sidebar Up to date/Refreshing/cached status text and the conversation header Showing retained history text with compact state orbs. The retained-history text is actually in ConversationPane.tsx, not the sidebar; cover both locations without conflating their resources.

- [ ] Project the existing worker-owned availability, freshness, synchronization and error states; distinguish initial loading, queued/refreshing, fresh idle, stale/retained and failed/unavailable states. Do not infer contiguous/newest coverage from retained facts.
- [ ] Communicate status through color and appropriate animation, with accessible names, a readable hover/focus description and a non-color-only alternative. Honor prefers-reduced-motion without losing state information.
- [ ] Remove the persistent visible status paragraphs, not actionable errors or failure detail. Avoid layout shifts and repetitive screen-reader announcements on each poll.
- [ ] Cover state transitions and keyboard/focus/reduced-motion behavior without adding UI polling or a second freshness store.

Owners: InboxList.tsx, ConversationPane.tsx and styles.scss. Global cross-pane errors remain under icr-jce7; a settings service is not required for system reduced-motion support.

## Shared motion/settings integration

icr-r54z is now the single shared preference/motion owner, pulled forward into current polish. Orbs must consume that effective motion gate (including live OS/user changes) rather than adding an independent persisted animation switch. Automatic-first recovery is now confirmed in icr-7h98.
