# Motion requirements

Settings (`#/settings`) provides System (default), Reduced, and Full motion.
`entrypoints/ui/preferences.ts` is the single global presentation preference
owner: it validates the `motion` key in `storage.local`, listens for other windows
and live OS changes, and gates the shell until the initial read resolves.
Storage failures are reported without pretending the choice was saved.
The shell exposes the effective mode for CSS and future consuming surfaces;
Reduced never delays route unmounting or focus restoration.

Animation consumers and retained exit lifecycles remain future work. The
[application contract](application-architecture.md) and [roadmap](roadmap.md)
own delivery and state boundaries. Preferences do not change fetching, retention,
canonical Instagram persistence, or autoplay.

## Required behavior

- Keep one application-shell preference owner in `storage.local`: System,
  Reduced, or Full. System follows `prefers-reduced-motion`; Full is an explicit
  override. Do not mix preferences with Instagram entities or media autoplay.
- Reduced disables all decorative motion, including continuous spinner rotation.
  State updates, unmounting, focus restoration, and actions remain immediate.
- Prefer narrowly scoped CSS transform/opacity feedback. Never animate layout,
  dimensions, the virtualizer's positioning transform, or scroll-anchor correction.
- Approved exception: `icr-f00w` physically slides visible sidebar conversations
  during activity/pin reorders through a separate presentation transform. Canonical
  order and fixed outer virtual slots update immediately; keep stable IDs, 72px
  rows, at most 31 mounted rows, correct hit targets and logical focus/anchors.
  Do not add offscreen rows or duplicate interactive clones for motion. Initial
  mount, scrolling/recycling, resize/folding and history placement remain immediate.
  Effective Reduced applies final positions without motion. This is planned,
  not an already implemented animation or a general layout-motion exception.
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
