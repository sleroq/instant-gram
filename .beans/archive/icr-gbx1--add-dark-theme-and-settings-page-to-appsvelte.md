---
# icr-gbx1
title: Add dark theme and settings page to App.svelte
status: scrapped
type: feature
priority: normal
created_at: 2026-07-04T17:33:47Z
updated_at: 2026-08-03T06:25:01Z
---

Add dark theme support and a settings page/entry point to entrypoints/ui/App.svelte, following the existing Svelte 5 UI patterns.

Checklist:

- [ ] Review current App.svelte layout/styling and related UI components.
- [ ] Add dark theme state/application with persistence if appropriate.
- [ ] Add a settings page or settings view reachable from App.svelte.
- [ ] Verify the popup UI build/typecheck for the changed path.

Superseded by the Teact dark visual refresh in docs/frontend-visual-refresh-plan.md. Dark-by-default styling is complete; the removed Svelte settings-page scope is not part of the current product design.
