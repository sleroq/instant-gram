---
# icr-b6uv
title: Teact message history and infinite scroll
status: completed
type: milestone
priority: high
tags:
    - chat-history
    - frontend
    - virtualization
created_at: 2026-08-02T23:19:32Z
updated_at: 2026-08-03T13:17:50Z
---

Implement Milestone 2 in docs/frontend-rewrite-plan.md from the reviewed Milestone 1 baseline.

Scope: extend the existing normalized HistoryState with bounded viewport IDs, older-page single-flight loading and one-page lookahead, selected-chat viewport filling, stable ID-plus-offset restoration, top-sentinel loading, anchor correction for prepend and media resize, complete MVP message rendering, and focused state/browser regressions.

Do not rewrite the working shell/chat list/store, add React runtime or generic virtualization, or copy GPL Telegram source/styles/assets. Preserve failed-cursor explicit-retry behavior and one-page warm histories.

Completed with normalized 40/80 message windows, local-first older navigation,
single-flight cursor-gated pagination, one-page adjacent preload, logical anchor
restoration and browser-measured prepend correction, rich message variants, and
focused state/browser regressions.

Independent review remediation added durable top-intersection reevaluation,
two-phase remote merge then commit-time anchor capture, correct beginning-marker
visibility/placement, and a production Teact/store Playwright harness covering
sentinel request counts, delayed-RPC user scrolling, and resize correction.
