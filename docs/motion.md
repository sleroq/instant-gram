# Motion requirements

Chats and Settings (`#/settings`) share a persistent sidebar tab list.
Settings exposes one Animations On/Off switch; there is no separate reduced mode.
`entrypoints/ui/preferences.ts` is the single global presentation preference
owner. It validates the boolean `motion` key in `storage.local`, listens for other
windows, and gates the shell until its initial read resolves. Before an explicit
choice is saved, the device’s initial/live motion preference supplies the default.
Earlier Full/Reduced saved choices are read as On/Off respectively.
Storage failures are reported without pretending the choice was saved.
Off never delays tab cleanup, focus restoration or actions.

Animation consumers and retained exit lifecycles remain future work. The
[application contract](application-architecture.md) and [roadmap](roadmap.md)
own delivery and state boundaries. Preferences do not change fetching, retention,
canonical Instagram persistence, or autoplay.

## Required behavior

- Keep one application-shell preference owner in `storage.local`: Animations
  On or Off. The unsaved default follows `prefers-reduced-motion`; an explicit
  choice overrides it. Do not mix preferences with Instagram entities or autoplay.
- Off disables all decorative motion, including continuous spinner rotation.
  State updates, unmounting, focus restoration, and actions remain immediate.
- Prefer narrowly scoped CSS transform/opacity feedback. Never animate layout,
  dimensions, the virtualizer's positioning transform, or scroll-anchor correction.
- Approved exception: `icr-f00w` physically slides visible sidebar conversations
  during activity/pin reorders through a separate presentation transform. Canonical
  order and fixed outer virtual slots update immediately; keep stable IDs, 72px
  rows, at most 31 mounted rows, correct hit targets and logical focus/anchors.
  Do not add offscreen rows or duplicate interactive clones for motion. Initial
  mount, scrolling/recycling, resize/folding and history placement remain immediate.
  Animations Off applies final positions without motion. This is planned,
  not an already implemented animation or a general layout-motion exception.
- Initial history, cached-window replacement, older prepend, reply positioning,
  and recycled rows must not trigger message-entry animation. Only newly accepted
  tail messages may receive optional entry feedback.
- Maintenance scrolling is immediate. Any future user-requested smooth scroll
  must respect reduced-motion and cancel on user input or a competing command.
- Add retained exit lifecycle only to overlays that need it. Presence timing
  does not own focus trapping, inertness, scroll lock, or action state; disabled
  motion must not delay cleanup. Do not create a generic animation framework.
- Test the device default and explicit On/Off behavior, keyboard/focus access,
  immediate disabled-mode cleanup, and unchanged 31-row inbox/80-row history
  bounds. Assert stable outcomes, not exact elapsed animation times.
