---
# icr-z4vy
title: Make all UI motion optional and animation-safe
status: todo
type: milestone
priority: high
tags:
    - ui
    - accessibility
    - performance
    - animations
    - discovered
created_at: 2026-08-09T19:32:29Z
updated_at: 2026-08-09T19:32:29Z
---

Implement the complete ICR motion system described in `docs/telegram-animation-research.md`. Telegram Web A is a behavioral reference only; do not copy GPL application source, SCSS, assets, or animation definitions.

## Goal

Make every current and new visual animation optional while retaining responsive, accessible, bounded inbox/history behavior. System reduced-motion must be honored by default, with a persisted user override.

## Scope

- [ ] Inventory all current UI transitions/keyframes and consolidate their duration/easing behind root motion tokens. No new ungated hard-coded animation duration.
- [ ] Add a presentation-only preference with **System** (default), **Reduced**, and **Full** modes. Persist only this choice; System follows live `prefers-reduced-motion` changes. Keep it outside Instagram entities/RPC/store caches.
- [ ] Apply one document/root mode gate before interactive UI surfaces mount. Reduced/System-reduce disables every transition, keyframe, and continuous spinner; it must not delay state, unmount, focus restoration, or action completion.
- [ ] Provide an accessible settings/control surface for the preference, with a clear selected state and keyboard operation.
- [ ] Correct the virtual inbox row styling so the transform that establishes its fixed 72px absolute position is never itself animated. Do not animate `top`, height, width, grid columns, row reorder, or history layout.
- [ ] Make only newly accepted tail/local message rows eligible for a brief optional enter. Initial history, cached restore, older prepend/window replacement, reply positioning, anchor correction, and virtual recycling must remain immediate.
- [ ] Gate existing sidebar-grip, status/error surface, reaction rail, preview badge, reel-modal, and spinner motion without changing their pointer, focus, status, error, inertness, or scroll-lock behavior.
- [ ] Add a small Teact-compatible retained-exit mechanism only for visually closing modal/contextual surfaces that need it: mount-hidden then next-frame open; keep mounted through closing; cancel close on reopen; settle through `transitionend` plus fallback; settle synchronously with motion off. Do not import Telegram hooks, FasterDOM, or a transition framework.
- [ ] Give the reel modal a symmetric optional exit and ensure it retains focus trapping/inert background/scroll lock until exit settlement, then restores invoking focus exactly once.
- [ ] Keep data-maintenance scrolling non-animated: initial open, history restore, older-page and resize anchor correction, incoming follow, and reply positioning. If an explicit user-initiated smooth-scroll affordance is added, make it motion-gated, cancellable by user input/competing commands, and immediate in Reduced mode.
- [ ] Update `docs/frontend-architecture.md` with ownership, preference persistence boundary, motion gate, and non-negotiable virtualization/anchor rules. Keep the research document current if the implementation changes a conclusion.

## Exclusions

No Telegram scheduler/heavy-animation integration, generic pane-stack/catalogue, animated emoji/reaction effects, CSS layout animation, autoplay changes, or duplicate component-owned data state.

## Acceptance

- System mode follows both initial and live `prefers-reduced-motion` state; Reduced and Full overrides persist and take precedence as named.
- With effective reduced motion, computed animations/transitions are disabled, spinner rotation is stopped, overlay close/focus restoration occurs without a timer delay, and all controls remain usable.
- With Full motion, eligible surfaces animate only transform/opacity and overlays clean up after their exit; reopening during close does not flash, unmount, or lose focus.
- Inbox stays exactly 72px fixed-row virtualized; scrolling/reordering does not animate placement or increase mounted rows. History stays at most 80 rows and anchor drift behavior remains unchanged through older loads/media resize.
- No maintenance scroll is animated, and no user preference causes network, normalized state, or mutation semantics to differ.
- Add focused pure/browser coverage for preference resolution/persistence/live media-query update, reduced/full modal lifecycle and focus, disabled spinner, virtual-row geometry, message eligibility, and no-motion history anchor/follow paths.
- Run `npm test`, `npm run check`, `npm run build`, `git diff --check`, and `beans check`.
