---
# icr-rvb8
title: Add focused-message Enter and Space shortcuts
status: completed
type: feature
priority: normal
tags:
    - solid-restoration
created_at: 2026-08-03T21:27:15Z
updated_at: 2026-09-13T12:05:14Z
parent: icr-jce7
---

Implemented focused-message Enter and Space shortcuts.

- Enter delegates only to the existing rendered reel-share button or inline-share link backed by its normalized target URL; no URL or route is derived.
- Plain Space uses the first established picker emoji (`❤`) through the existing store `setReaction`; pending and already-default states are unhandled no-ops, while accepted mutations preserve single-flight, optimistic rollback, authoritative receipts, and stable IDs.
- Editors, modifiers, nested controls, menus, pickers, and dialogs retain native keys.
- Production browser coverage pins j/k activation, exact destination, text no-op, exact-once reaction, pending/current no-ops, suppression, failure rollback, thread switching, and unchanged bounded-window/pagination state.
- No RPC or Instagram protocol capability was added; no GPL source/assets or HAR content was used.

Verified focused browser/store tests, two consecutive full `npm test` runs at 126/126 on an isolated workspace snapshot (the shared workspace had concurrent build/HMR activity), `npm run check`, `npm run build`, `git diff --check`, and `beans check`.

## Solid restoration handoff (2026-09-13)

This completion records retired behavior. Restore it only as part of R3.17–R3.18 under `icr-jce7`, after durable reaction/media capabilities exist, while preserving bounded views and shortcut exclusions.
