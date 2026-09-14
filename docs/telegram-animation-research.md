# Telegram Web A animation research and ICR adaptation

**Status: historical behavioral research, not a current implementation plan.**
The Teact runtime and UI discussed below have been removed. The
[application architecture](application-architecture.md) and
[restoration checklist](solid-restoration-checklist.md) govern Solid restoration:
honor system reduced-motion from each feature's first version, never animate
row placement or anchor correction, and defer explicit preferences to their
single settings owner. Do not restore the old animation machinery.

**Reference reviewed:** [`Ajaxy/telegram-tt@a323b1f`](https://github.com/Ajaxy/telegram-tt/tree/a323b1f29f5b91e9a32b8c14866234e925fb0bfa), independently inspected on 2026-08-09.

This is a clean-room behavioral study. Telegram Web A is GPL-3.0-or-later;
ICR must not copy its application source, SCSS, icons, assets, or animation
definitions. The local Teact runtime is a smaller pinned MIT fork and excludes
Telegram's FasterDOM and heavy-animation machinery. This document specifies an
ICR-sized implementation, not a port.

## Finding: Telegram uses three layers

1. **CSS owns ordinary feedback.** Telegram centralizes durations/easings in
   [`_variables.scss`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/styles/_variables.scss#L329-L354)
   (notably 200ms selection and 300ms layer/slide transitions), then applies
   `transform`/`opacity` keyframes and transitions to rows, panes, menus, and
   media. Its general transition catalogue includes fades, slides, zooms, and
   layered panes in
   [`Transition.scss`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/components/ui/Transition.scss).

2. **Small lifecycle state machines make enter/exit reliable.**
   [`useShowTransition.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/hooks/useShowTransition.ts#L47-L164)
   uses `closed → scheduled-open → open → closing`. It first commits a hidden
   element, promotes it to open on a later measure pass, and keeps it mounted
   through a timed close before unmounting. The state machine cancels a pending
   close if reopened. `Transition.tsx` separately retains outgoing and incoming
   pane children through a swap, then removes inactive content after completion.

3. **JavaScript interpolation is exceptional.**
   [`animateScroll.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/util/animateScroll.ts#L39-L237)
   has one active scroll animation, cancels superseded work, temporarily removes
   scroll snap, bounds travel, and falls back to an immediate scroll when
   interface animation is disabled. It coordinates with Telegram's heavy
   animation scheduler; ICR does not have or need that scheduler.

## Finding: Telegram makes effects configurable, but ICR must do better

Telegram has `max`, `med`, and `min` performance presets. Its minimum preset
turns off page, send, media-viewer, composer, context-menu, right-column,
reaction, autoplay, and effect categories
([`initialState.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/global/initialState.ts#L23-L80)).
`applyPerformanceSettings` maps those settings to body classes such as
`no-page-transitions` and `no-message-sending-animations`
([`perfomanceSettings.ts`](https://github.com/Ajaxy/telegram-tt/blob/a323b1f29f5b91e9a32b8c14866234e925fb0bfa/src/util/perfomanceSettings.ts#L3-L25)).

At the reviewed revision, this is a performance setting rather than a
`prefers-reduced-motion` policy. ICR already has a broad reduced-motion SCSS
override, but it has no explicit user preference and preserves spinner rotation.
For ICR, **every animation, including continuous loading rotation, is optional**:

- Default to the operating-system preference (`prefers-reduced-motion`).
- Offer a persisted UI choice: **System**, **Reduced**, or **Full**. Full is an
  explicit override; Reduced always disables decorative and continuous motion.
- Reduced motion changes visual state immediately; it must not delay unmount,
  focus restoration, scroll anchoring, loading, or action completion.
- Do not conflate this presentation setting with normalized Instagram entities,
  RPC state, or media autoplay. Inline history media remains explicitly
  user-started regardless of motion choice.

## Current ICR inventory

`entrypoints/ui/styles.scss` already contains a 120ms token and the following
motion. The milestone should consolidate and gate it rather than add parallel
rules.

| Surface                               | Existing behavior                                                                     | ICR target                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar resize grip                   | Opacity fade on hover/focus                                                           | Keep as optional feedback; resizing itself remains direct and non-animated.                                                                                                                  |
| Virtual inbox row                     | `opacity`/`transform` transition; row position is a transform used for virtualization | Never animate the virtual positioning transform, `top`, height, or reorder. Limit optional feedback to an inner/select-state element so scrolling stays exact.                               |
| Status, error, and menu-like surfaces | Short `surface-in` fade/translate                                                     | Optional enter and real exit lifecycle where a surface currently disappears.                                                                                                                 |
| History message rows                  | `message-in` fade/translate                                                           | Only animate newly accepted local/incoming tail messages. Never animate initial history, cached-window replacement, older prepend, reply positioning, or rows recycled by the 80-row window. |
| Reaction rail and preview play badge  | Opacity/scale transitions                                                             | Keep optional; preserve pointer/focus usability with no motion.                                                                                                                              |
| Reel modal                            | Backdrop fade and dialog scale/translate enter                                        | Add symmetric, retained exit before inertness/scroll lock/focus restoration are released.                                                                                                    |
| Spinner                               | Infinite rotation                                                                     | Optional; reduced mode presents a static busy indicator plus existing accessible status.                                                                                                     |

The existing global reduced-motion rule is a useful safety net, but a duration
near zero still creates lifecycle ambiguity and cannot represent a user choice.
The implementation must use a semantic root motion mode and make JS completion
immediate when motion is off.

## ICR design decisions

### 1. One root preference and CSS gate

Create a small UI-preference module, owned by the application shell rather than
the domain store. It reads/writes only the presentation preference, observes
`matchMedia('(prefers-reduced-motion: reduce)')` while in System mode, and places
one mode attribute/class on the extension document root/body before interactive
surfaces are mounted. Use CSS custom properties for the short, normal, and
overlay durations/easings. In Reduced mode, all are zero and a root selector
disables transitions/animations; in System mode the media query does the same.

This gives a single auditable gate. New motion may not introduce an ungated hard
coded duration. A compact settings/control surface may expose the three choices;
the preference needs an accessible name and selected state.

### 2. CSS first, transform/opacity only

Use 120–220ms transform/opacity feedback for the small extension UI. Do not
animate layout, dimensions, grid columns, list `top`, or virtual-row placement.
Avoid `filter`/backdrop animation and permanent `will-change`; add compositing
hints only while an actual overlay transition needs them. This is stricter than
Telegram's broad catalogue because ICR has fixed-row virtualization, variable
height anchored history, and a much smaller product surface.

### 3. Retained exit only where it changes the user experience

CSS-only entry is sufficient for stable rows and status notices. Overlays and
transient contextual surfaces that visibly close need a local Teact-compatible
enter/exit controller: mount hidden, advance to open on the next animation
frame, retain during closing, cancel a closing timer when reopened, and unmount
on `transitionend` with a duration-based fallback. When motion is disabled,
enter/exit completes synchronously. Do not import Telegram hooks or recreate its
FasterDOM layer.

The controller owns only DOM presence/class timing. Existing components retain
focus trapping, inertness, scroll lock, popup placement, and action state.

### 4. Scroll correctness wins

All data-maintenance scrolling remains immediate: initial chat open, cached
history restore, older-page anchor correction, resize correction, incoming
bottom follow, and reply target positioning. If an explicit user command later
needs a short smooth scroll, make it opt-in, cancel it on wheel/touch/keyboard or
a competing command, and jump immediately in Reduced mode. It must never share
the history anchor correction path.

### 5. Test behavior, not elapsed milliseconds

Focused browser coverage should force System+reduce and explicit Reduced/Full
modes. It should prove that disabled mode has no running animation, no delayed
close/unmount/focus restoration, no automatic scroll animation, and unchanged
keyboard/pointer access. Full-mode tests should wait for stable DOM outcomes
rather than asserting a precise duration. Preserve the existing 72px inbox and
80-row history checks while exercising each relevant animated surface.

## Deliberate omissions

Do not bring in Telegram's performance presets, FasterDOM, heavy-animation
registration, generic transition catalogue, custom scroll animator, animated
emoji/reaction effects, autoplay, or pane-stack framework. ICR needs one
preference, narrowly scoped CSS, and at most one small retained-exit primitive.

## Source trail

- Telegram CSS duration tokens: `_variables.scss` lines 329–354.
- Telegram pane variants/keyframes: `components/ui/Transition.scss`.
- Telegram show/hide lifecycle: `hooks/useShowTransition.ts` lines 47–164.
- Telegram preference-to-body-class mapping: `util/perfomanceSettings.ts` lines
  3–25 and `global/initialState.ts` lines 23–80.
- Telegram cancellable scroll interpolation: `util/animateScroll.ts` lines
  39–237.
- Local constraints: [`teact-guide.md`](./teact-guide.md) and
  [`frontend-architecture.md`](./frontend-architecture.md).
