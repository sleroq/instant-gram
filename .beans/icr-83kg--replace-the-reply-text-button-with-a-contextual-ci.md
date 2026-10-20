---
# icr-83kg
title: Replace the Reply text button with a contextual circular icon
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:29:43Z
parent: icr-i2ye
blocked_by:
    - icr-xmnd
---

Use the existing R2 reply action through a circular icon to the right of the message, revealed on row hover or focus-within. For long/tall messages anchor it at the bottom-right rather than beside the top of the text.

- [ ] Remove the persistent Reply text button without changing reply eligibility, composer targeting or mutation behavior.
- [ ] Give the icon an accessible Reply name and keyboard focus; preserve a discoverable, usable touch/non-hover path. Hidden controls must not shift bubbles or collide with text, timestamps, media or adjacent rows.
- [ ] Keep synthetic/pending-message restrictions and test long messages, keyboard use and compact layout.

Owners: MessageRow.tsx and styles.scss. This is ready before R3 because reply sending already exists. R3 reaction rails/context menus must compose with this action area, not add a second Reply button.
