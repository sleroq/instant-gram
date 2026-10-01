---
# icr-45nb
title: Keep ConversationPane reactive reads in the Solid effect compute phase
status: completed
type: bug
priority: normal
tags:
    - discovered
    - ux
created_at: 2026-09-30T09:07:43Z
updated_at: 2026-09-30T22:14:25Z
parent: icr-siiy
---

Live dev-extension inspection on 2026-09-30 produced STRICT_READ_UNTRACKED at ConversationPane.tsx:151/159, repeated 5,139 times during history navigation. The effect compute phase passes a joined IDs key, but its apply phase reads allIds() and savedAnchor props directly. Dependency overlap currently masks some functional risk; no stale-render or UI hang was established. Capture required reactive inputs in the compute result and keep apply phase imperative. Do not blanket-suppress diagnostics with untrack. Acceptance: existing bounded history/anchor behavior passes and the equivalent dev navigation/reselection flow emits no STRICT_READ_UNTRACKED warnings.

## Fix-pass outcome — 2026-09-30

Completed: reactive inputs are captured in effect compute, not imperative apply. No blanket untrack suppression. Browser regressions preserve anchors/bounds; equivalent installed navigation/reselection has zero observed STRICT_READ_UNTRACKED, REACTIVITY_HALTED and URI errors. Final suite: 173 passed.
