---
# icr-j8fk
title: Automatically adopt newest history at the logical chat bottom
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:41:26Z
parent: icr-i2ye
blocked_by:
    - icr-yqp8
---

Remove the textual Show latest messages coverage-switch control. The user expects new/current messages to load automatically when genuinely following the chat bottom, while an older-reading position must not jump.

- [ ] Reuse worker-owned load-newer-history/current-head adoption. DOM-bottom of an 80-row slice, 400-ID projection or previous generation alone is not proof of the newest chat tail. Preserve explicit bottom-follow intent across incoming head changes and traverse cached newer coverage before selecting the current head as appropriate.
- [ ] If the user was following newest, adopt newly refreshed current coverage automatically with a bounded latest window. While reading older messages or a reply target, preserve the exact logical anchor; a floating down/return action can express explicit navigation intent.
- [ ] Remove the old text button, not newerCoverageAvailable, cachedNewer, previous-generation evidence or cursor-linkage checks. Never concatenate detached ranges to fabricate continuity or mark unseen arrivals read.
- [ ] Share bottom-clearance measurements with floating composer icr-yqp8. Distinguish a deliberate request to reach newest from ordinary window recycling, short-viewport fill and merely reaching a stale slice edge.
- [ ] Replace the browser test requiring the old Show latest interaction with genuine-tail auto-adoption and older-anchor preservation coverage, including disjoint heads and incoming updates.

Owners: ConversationPane.tsx and the existing worker history-selection boundary as needed. This intentionally changes the approved UX, not the rule that retained facts do not prove contiguous coverage.
