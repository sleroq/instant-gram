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
updated_at: 2026-10-20T21:05:02Z
parent: icr-i2ye
---

Remove the visible 8px resize-button strip between inbox and conversation. The separator should have no visible layout width, while retaining an overlapping/invisible usable drag target and col-resize cursor.

- [x] Remove the visible fill/borders and dedicated strip appearance without setting the interactive target itself to an unusable zero width.
- [x] Preserve semantic separator ARIA values, keyboard arrows/Home/End, visible keyboard focus, pointer capture/cleanup and current responsive min/max bounds.
- [x] Reconcile the layout's 8px allowance in the owning resize bounds only as needed; do not add preference persistence (the current width is window-local).
- [x] Cover pointer/keyboard operation, semantic accessibility state and cleanup with behavior-only tests. Preserve logical message identity/focus and the 31-inbox/80-history mounted-row limits across resizing and traversal; fixed 72px inbox slots remain a production contract, not an automated size assertion.
- [x] Manually inspect strip invisibility, pointer discoverability, visible keyboard focus and desktop/compact layout. Do not assert geometry, exact widths/offsets, computed styles, CSS/source strings or screenshots in tests (see tests/AGENTS.md).

Owners: Sidebar.tsx and styles.scss. This is visual polish of the existing Solid separator, not another resize implementation.

## Implementation and verification

- Removed the dedicated grid allowance/fill/borders; retained an overlapping transparent 8px pointer target, col-resize cursor and visible keyboard focus. Width remains window-local.
- Fresh responsive behavior coverage exposed a stale Solid signal read during viewport clamping. Resize now supplies the current viewport directly to the existing bounds owner.
- Bun 1.4.3: frozen install, Chromium setup, lint, isolated `bun run test` (190 passed across 25 files; history browser 21/21), typecheck, build, diff check, Beans check and shared ast-grep scan passed.
- Behavior coverage includes semantic bounds/arrows/Home/End/tab focus, real pointer capture/release/cancellation, active-drag disposal on compact unmount, logical history/inbox focus and mounted-row budgets. No automated visual/design assertions or hidden visual-check helpers.
- Manual mock-Port browser inspection at 1100 desktop, 700 narrow desktop and 600 compact: panes meet without a strip, boundary drag works, keyboard outline remains visible, compact conversation/Back/inbox routes remain usable. Screenshots inspected locally, not goldens. Existing narrow conversation-title compression is unchanged and outside this task.
- Independent review: `4cb478a8-afbe-40fc-847e-69e64a4eded1`, Pi/OpenAI Codex `gpt-6.1-sol`, high reasoning: no actionable findings, including test-policy compliance. Reviewer independently passed history 21/21, lint, typecheck, build, Beans/diff checks and shared scan; no tracked edits.
- Evidence limits: headless screenshots do not show the native cursor glyph; pointer discoverability was exercised by manual boundary dragging, not computed-style assertions. Mock fixtures do not prove installed-extension or live Instagram behavior; no real account was mutated. No merged/deployed acceptance or parent-milestone completion is claimed.
