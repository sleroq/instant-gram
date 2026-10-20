# Test policy

## UI tests: behavior only

- Test user actions and observable outcomes: click/keyboard input opens a popup,
  expected content and controls are visible, and unavailable or hidden content is
  not rendered where it should not be. Assert absence from the DOM when the
  requirement is unmounting, not merely invisibility.
- Keep coverage for navigation, focus, keyboard/accessibility, drafts, replies,
  command dispatch/results, loading/errors/retry, account isolation, recovery,
  and logical message identity after history traversal.
- Do not assert element width/height, bounding boxes, exact scroll coordinates or
  pixel offsets, spacing, alignment, colors, fonts, borders, opacity, transforms,
  transitions, animations, or other visual/design properties. Do not assert CSS
  classes, computed styles, stylesheet/source text, or screenshots to lock down
  appearance. Do not enforce icon-only versus text presentation.
- Delete tests whose only purpose is a visual/design assertion. In mixed tests,
  remove those assertions and their now-unused setup; preserve behavior checks.
  Review appearance manually, not through automated design-contract tests.
- Geometry may drive scrolling or identify the currently visible message in a
  behavior test; never compare geometry against expected design values. Test
  restored message identity/focus rather than pixel-perfect positioning.
- Mounted-row limits and window traversal are functional resource contracts, not
  design assertions. Keep their behavioral coverage. Media dimensions in provider
  parsing fixtures are domain data, not assertions about rendered element sizes.

## Keep tests focused

- Use roles, accessible names, and user-visible content for interactions and
  assertions. Use stable domain IDs when identity itself is the behavior.
- Exercise production code with the smallest useful fixture. Do not replace
  deleted visual checks with equivalent checks in another file or helper.
- Wait for observable outcomes rather than adding fixed sleeps. Mocked-Port
  browser tests do not establish live Instagram or installed-extension behavior.
- Follow the verification commands in [repository guidance](../AGENTS.md#verification).
