---
# icr-omoc
title: Hide the sidebar resize strip without shrinking its hit target
status: completed
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T20:07:45Z
parent: icr-i2ye
---

Remove the visible 8px resize-button strip between inbox and conversation. The separator should have no visible layout width, while retaining an overlapping/invisible usable drag target and col-resize cursor.

- [x] Remove the visible fill/borders and dedicated strip appearance without setting the interactive target itself to an unusable zero width.
- [x] Preserve semantic separator ARIA values, keyboard arrows/Home/End, visible keyboard focus, pointer capture/cleanup and current responsive min/max bounds.
- [x] Reconcile the layout's 8px allowance in the owning resize bounds only as needed; do not add preference persistence (the current width is window-local).
- [x] Prove pointer and keyboard resizing still work, narrow viewports remain correct, and fixed 72px inbox rows/31-row mount bounds and message anchors survive resizing.

Owners: Sidebar.tsx and styles.scss. This is visual polish of the existing Solid separator, not another resize implementation.

Implemented a transparent 16px separator centered over the pane boundary with no dedicated grid column, an inset keyboard focus outline, and touch drag handling. Removed the obsolete 8px bounds allowance and clamp directly against the measured viewport during resize so Solid batching cannot leave a stale pane width.

Verification: `bun run lint`; `bun run test` (194 passed, 0 failed across 25 files); `bun run check`; `bun run build`; `git diff --check`; `beans check`; `ast-grep scan --config "$HOME/sgconfig.yml" --no-ignore hidden .`. All passed. Production-browser assertions cover both overlap edges, cursor/focus/ARIA, ArrowLeft/ArrowRight/Home/End, pointer bounds/capture/release/cancellation/disposal, 720/700/699px routing, 72px inbox slots with <=31 mounted rows, <=80 history rows, and wrapped-history logical ID/pixel anchors through resizing.

Independent read-only reviewer: `/root/review_divider`; no actionable findings. Reviewer independently reran four focused production-browser tests (4 passed) and `git diff --check`. Mocked extension Ports only; no installed-extension/live-account validation. Folding, physical reorder animation, and preference persistence remain outside this task.
