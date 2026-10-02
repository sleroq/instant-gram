# Motion requirements

Motion is future R5 scope, not a description of an implemented animation system.
The [application contract](application-architecture.md) and
[restoration checklist](solid-restoration-checklist.md) own delivery and state
boundaries. The current UI honors system reduced-motion.

## Required behavior

- Keep one application-shell preference owner in `storage.local`: System,
  Reduced, or Full. System follows `prefers-reduced-motion`; Full is an explicit
  override. Do not mix preferences with Instagram entities or media autoplay.
- Reduced disables all decorative motion, including continuous spinner rotation.
  State updates, unmounting, focus restoration, and actions remain immediate.
- Prefer narrowly scoped CSS transform/opacity feedback. Never animate layout,
  dimensions, virtual-row positioning, reorder, or scroll-anchor correction.
- Initial history, cached-window replacement, older prepend, reply positioning,
  and recycled rows must not trigger message-entry animation. Only newly accepted
  tail messages may receive optional entry feedback.
- Maintenance scrolling is immediate. Any future user-requested smooth scroll
  must respect reduced-motion and cancel on user input or a competing command.
- Add retained exit lifecycle only to overlays that need it. Presence timing
  does not own focus trapping, inertness, scroll lock, or action state; disabled
  motion must not delay cleanup. Do not create a generic animation framework.
- Test System+reduce and explicit Reduced/Full behavior, keyboard/focus access,
  immediate disabled-mode cleanup, and unchanged 31-row inbox/80-row history
  bounds. Assert stable outcomes, not exact elapsed animation times.

## Clean-room boundary

Telegram Web A is a behavioral reference only and is GPL-3.0-or-later. Do not
copy its source, SCSS, icons, assets, or animation definitions. Do not introduce
its performance presets, FasterDOM/heavy-animation machinery, pane framework,
custom scroll animator, or autoplay as part of this work.
