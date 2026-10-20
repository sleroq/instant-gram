---
# icr-r54z
title: Build a settings page with one shared preference and motion owner
status: todo
type: feature
priority: high
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T19:51:41Z
parent: icr-i2ye
---

Build the settings page for animations, caching and loading with one shared preference authority. Expose cache/loading controls only after their policies and capabilities are defined.

- [ ] Design and implement an accessible routed settings page/entry point in the sole Solid UI, preserving Messages route, draft, focus and logical scroll restoration on return. Do not add an empty navigation rail or unsupported switches.
- [ ] Own small global preferences in one storage.local service with validated defaults and cross-window updates. Resolve System/Reduced/Full animation mode before animated surfaces mount, follow live OS changes in System mode, and support immediate cleanup/focus restoration when effective motion is reduced.
- [ ] When taking on settings design, agree which configuration controls and defaults should exist; cache/loading choices are not a question the user must settle now. Initially expose functioning animation preferences. Connect unread loading to icr-sik0 (recent unread conversations, configurable lookback or authorized capped fallback) and expose each control only when its actual capability exists. Create concrete cache-policy work only if selected; icr-li1d is merged here, not a separate prerequisite.
- [ ] Separate global presentation choices from account-partitioned Instagram resources and worker read/storage policy. UI owns no alternate persistence authority for canonical facts, outbox or retry state.
- [ ] Cover persistence, validation, live cross-window/OS updates, routing/accessibility and motion gating; no new animation framework. Add storage permission only with the consuming implementation if needed.

This is the sole consuming owner for current polish and later R3/R4 surfaces; R5 must not implement a second settings system. Configuration details/defaults are decided during this task. The user has resolved unread preload scope and approved physical sidebar sliding; those are not outstanding design blockers. No cache policy change is implied by a settings-page request.
