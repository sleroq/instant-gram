---
# icr-jce7
title: 'R3: Restore full message interactions'
status: todo
type: milestone
priority: high
tags:
    - solid-restoration
    - dm
    - interactions
created_at: 2026-09-13T12:04:07Z
updated_at: 2026-10-20T19:49:38Z
blocking:
    - icr-9ib2
blocked_by:
    - icr-uizd
---

Deliver reactions, timed editing, staged forwarding, reply navigation, context menus, keyboard/clipboard and actionable feedback after icr-i2ye. Commands and reconciliation remain worker-owned; Solid projects bounded views.

## Current owners

- icr-njy9: functional reactions and picker; icr-dtee: reaction/menu motion.
- icr-u9ok: context menus; icr-7zgg: pin placement. Keep the header pin control until menus replace it.
- icr-zoba: reply navigation and return-stack integration with icr-mwu8.
- icr-83kg: existing contextual Reply appearance. icr-r54z: shared settings/motion.

Acceptance includes stable rows through reaction/edit receipts, partial forwarding retry without repeated settled stages, recoverable missing reply targets, exact focus restoration, no long-press click-through and no unintended page fetches during local navigation. Run focused tests and the repository quality gate.

## Task-owned acceptance

- [ ] **Timed edit.** Edit outgoing text within an inclusive 15-minute window, matching IDs and timestamp. Preserve draft/reply on cancel.
- [ ] **Edit reconciliation.** Retry with immutable IDs and retain receipt overlay until echo, using an explicit bounded policy (starting proposal: three merges or two minutes), never a silent eternal overlay.
- [ ] **Supported sources.** Forward text, reels, and feed posts to at most five loaded targets; disable unsupported attachments with an explanation.
- [ ] **Target chooser.** Restore simple fuzzy filtering over loaded targets without a new dependency. When supplied, send and confirm the optional comment-before-share as its durable stage before the share stage.
- [ ] **Durable stages.** Give every target/stage an immutable ID; retry only incomplete stages after partial failure and never mutate source history.
- [ ] **Feedback.** Report partial completion and errors through global toasts/sync status retained across panes.
- [ ] **Physical shortcuts.** J/K/H/L navigate pane/rows; Ctrl+O returns or goes newest even from composer unless a contextual surface/dialog owns input; Enter activates a reply-preview target before a share action; Space toggles heart.
- [ ] **Shortcut exclusions.** Editors, modifiers, and nested native controls suppress shortcuts except the documented Ctrl+O composer behavior. Row/pane movement does not paginate or expand the viewport; selecting an inbox row may naturally subscribe to/load that thread.
- [ ] **Copy post URL.** Copy the parser-provided canonical target URL and announce keyboard-accessible success/failure.
- [ ] **Global feedback.** Toast and synchronization errors survive pane transitions and retain actionable failure detail.
