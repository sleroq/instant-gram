---
# icr-omoc
title: Hide the sidebar resize strip without shrinking its hit target
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
---

Remove the visible 8px resize-button strip between inbox and conversation. The separator should have no visible layout width, while retaining an overlapping/invisible usable drag target and col-resize cursor.

- [ ] Remove the visible fill/borders and dedicated strip appearance without setting the interactive target itself to an unusable zero width.
- [ ] Preserve semantic separator ARIA values, keyboard arrows/Home/End, visible keyboard focus, pointer capture/cleanup and current responsive min/max bounds.
- [ ] Reconcile the layout's 8px allowance in the owning resize bounds only as needed; do not add preference persistence (the current width is window-local).
- [ ] Prove pointer and keyboard resizing still work, narrow viewports remain correct, and fixed 72px inbox rows/31-row mount bounds and message anchors survive resizing.

Owners: Sidebar.tsx and styles.scss. This is visual polish of the existing Solid separator, not another resize implementation.
