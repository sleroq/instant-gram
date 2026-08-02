---
# icr-b6uv
title: Teact message history and infinite scroll
status: todo
type: milestone
priority: high
tags:
    - chat-history
    - frontend
    - virtualization
created_at: 2026-08-02T23:19:32Z
updated_at: 2026-08-02T23:19:32Z
---

Implement Milestone 2 in docs/frontend-rewrite-plan.md from the reviewed Milestone 1 baseline.

Scope: extend the existing normalized HistoryState with bounded viewport IDs, older-page single-flight loading and one-page lookahead, selected-chat viewport filling, stable ID-plus-offset restoration, top-sentinel loading, anchor correction for prepend and media resize, complete MVP message rendering, and focused state/browser regressions.

Do not rewrite the working shell/chat list/store, add React runtime or generic virtualization, or copy GPL Telegram source/styles/assets. Preserve failed-cursor explicit-retry behavior and one-page warm histories.
