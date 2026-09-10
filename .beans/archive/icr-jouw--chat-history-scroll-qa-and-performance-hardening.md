---
# icr-jouw
title: Chat history scroll QA and performance hardening
status: scrapped
type: milestone
priority: normal
tags:
    - chat
    - scroll
    - qa
created_at: 2026-07-04T17:30:34Z
updated_at: 2026-08-03T13:17:25Z
blocked_by:
    - icr-5npn
---

Large-size milestone: verify and harden virtualized history, background preload, and scrollToMessage behavior under realistic chat-history conditions.

Goal:
Make the new scroll system reliable enough for long Instagram DM threads, dynamic content, and reply navigation.

Implementation notes:

- Coordinate with existing chat-history UX verification milestone icr-5uvl rather than duplicating any manual QA already tracked there.
- Use browser HAR/example data from docs/examples if request/response shape is needed for realistic scenarios.
- Prefer focused regression coverage for anchor preservation and API outcomes where feasible.

Checklist:

- [ ] Define manual QA scenarios for initial open, thread switch/restore, jump bottom, older prepend, background preload, and reply target navigation.
- [ ] Test long threads with hundreds/thousands of loaded messages and confirm bounded DOM nodes.
- [ ] Test dynamic-height rows: long text, reels, avatars/images loading after render.
- [ ] Test slow network older-page fetches while the user scrolls and switches threads.
- [ ] Test explicit scrollToMessage for loaded, unloaded, and missing message ids.
- [ ] Verify passive reply-target preparation never scrolls the viewport.
- [ ] Add a focused automated test or lightweight harness if practical for anchor preservation/search behavior.
- [ ] Run build/typecheck and document any residual manual-only risks.

Acceptance criteria:

- No visible jump when older messages are inserted above the viewport.
- DOM size remains bounded under large loaded history.
- scrollToMessage behavior is deterministic across loaded/unloaded/missing targets.
- Known limitations and verification results are documented in this bean before completion.

## Disposition (2026-08-03)

Scrapped after codebase review. This describes the removed Svelte/TanStack virtualizer and a 200-message background buffer, neither of which exists nor fits the current Teact architecture. The implemented supported behavior is the normalized 40–80 row history window with one-page lookahead and anchor correction documented in `docs/frontend-architecture.md`. Reply navigation/prefetch is not an active product requirement and should be re-scoped from the current architecture if needed later.
