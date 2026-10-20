---
# icr-r54z
title: Build a settings page with one shared preference and motion owner
status: completed
type: feature
priority: high
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:41:26Z
updated_at: 2026-10-20T21:17:32Z
parent: icr-i2ye
---

Build a routed settings page with one shared presentation preference authority. Initial configuration is System (default), Reduced, or Full motion. Cache/loading controls stay absent until their policies and capabilities exist; no cache policy is selected here.

- [x] Design and implement an accessible routed settings page/entry point in the sole Solid UI, preserving Messages route, draft, focus and logical scroll restoration on return. Do not add an empty navigation rail or unsupported switches.
- [x] Own small global preferences in one storage.local service with validated defaults and cross-window updates. Resolve System/Reduced/Full animation mode before animated surfaces mount, follow live OS changes in System mode, and support immediate cleanup/focus restoration when effective motion is reduced.
- [x] Decide concrete configuration during settings design (System by default, with Reduced and Full overrides); cache/loading choices are not a question the user must settle now. Initially expose functioning animation preferences. Connect unread loading to icr-sik0 (recent unread conversations, configurable lookback or authorized capped fallback) and expose each control only when its actual capability exists. Create concrete cache-policy work only if selected; icr-li1d is merged here, not a separate prerequisite.
- [x] Separate global presentation choices from account-partitioned Instagram resources and worker read/storage policy. UI owns no alternate persistence authority for canonical facts, outbox or retry state.
- [x] Cover persistence, validation, live cross-window/OS updates, routing/accessibility and motion gating; no new animation framework. Add storage permission only with the consuming implementation if needed.

- [x] Test behavior and accessible controls, navigation, drafts/acceptance, focus and restored logical message identity. No CSS, computed-style, animation, screenshot or pixel-design assertions. Review appearance manually under tests/AGENTS.md.
- [x] Complete independent review and final verification before publishing the replacement PR.

This is the sole consuming owner for current polish and later R3/R4 surfaces; R5 must not implement a second settings system. Configuration details/defaults are decided during this task. The user has resolved unread preload scope and approved physical sidebar sliding; those are not outstanding design blockers. No cache policy change is implied by a settings-page request.

## Implementation and evidence

- `preferences.ts` owns the validated global `storage.local` motion key, one live OS listener and one storage listener per shell. The shell waits for its initial read before rendering surfaces. Failed reads use System with an honest error; failed writes preserve the committed preference and radio selection. The storage permission is consumed by this implementation.
- `#/settings` has native labelled radios, current effective mode, save feedback and a Messages return. Navigation retains the selected thread without resubscribing, App-owned drafts/accepted-version guards, and existing logical history/inbox anchors. Returning focus goes to the Settings entry point, not a competing inbox-restoration callback.
- Behavior coverage: stored-value validation/removal, live System OS changes, explicit Full/Reduced, reload persistence, shared cross-window updates, initial-read/event ordering, read/write failure, keyboard focus, direct Settings/Back, compact/desktop logical reading restoration and draft acceptance while Settings is open. Resource bounds remain covered.
- Manual appearance: inspected Chromium screenshots at 1200×850 and 390×844 in a safe mocked-Port/storage fixture; reviewed heading/description hierarchy, radio card states, text wrapping, visible focus, return link, footer and compact Messages entry point. No real Instagram account was touched. Screenshots are manual evidence only, not assertions or goldens.
- Fresh verification uses Bun 1.4.3 (temporary binary because system Bun is 1.3.13), preserving the per-file `bun run test` script. After rebasing onto `origin/master` at `dbc9896`: 211 tests across 26 isolated files, zero failures. The history-browser conflict retains both upstream and Settings behavior coverage; production changes are unchanged apart from upstream context. Lint, typecheck, production build, git diff --check and beans check pass. Shared ast-grep scan completes with the single inapplicable parser finding explained below.
- Independent reviewer (before the rebase): Pi/OpenAI Codex `gpt-6.1-sol`, high reasoning, agent `859128c6-ff96-41f0-8845-081c96e12de9`. No actionable findings; explicitly checked tests/AGENTS.md compliance and validated the external-parser scan explanation. Independently passed 31 browser tests, lint, typecheck, Beans and diff checks; did not claim to rerun the full suite or prove live extension behavior. Follow-up independently reran all 22 history browser cases, including both new inbox-restoration cases, and confirmed test-policy compliance with no new findings.
- Shared scan: the remaining `unknown` parameter in `validateMotion` is the external-storage parser boundary itself. Narrowing it to a trusted preference before validation would discard the validation guarantee; this finding is inapplicable and is not suppressed.
- Mocked browser evidence establishes UI and preference semantics, not installed-extension or live Instagram API behavior. Future animation consumers, unread loading and cache/retention policy remain out of scope.
