---
# icr-u9ok
title: 'R3: Restore accessible message and conversation context menus'
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:48:02Z
parent: icr-jce7
blocked_by:
    - icr-i2ye
---

Own the context-menu scope from icr-jce7 in this implementation child; do not build a parallel menu system just for pinning.

- [ ] Support message and conversation targets with capability-appropriate actions, right-click, ContextMenu/Shift+F10 and compact long-press (500ms; cancel after 10px movement/cancel; suppress generated click).
- [ ] Clamp menus to the viewport, dismiss safely, restore focus to the invoking stable domain target and preserve focus after conversation reordering.
- [ ] Make conversation-row/header context entry points support conversation actions; do not confuse thread pinning with message pinning. Add only actions backed by implemented commands.
- [ ] Compose message actions with the pre-R3 contextual Reply control (icr-83kg) and future R3 reaction rail rather than duplicating controls.
- [ ] Cover pointer, keyboard, touch, bounds, focus and no click-through. Remain blocked until icr-i2ye is completed.

This is R3 work, not part of the current polish delivery. It is the explicit prerequisite for removing the header Pin/Unpin button.

## Animation ownership

Implement functional accessible menus here; icr-dtee owns their later animation lifecycle and is blocked by this bean. Consume the shared settings gate icr-r54z; do not add a second preference service or generic retained-exit system.
