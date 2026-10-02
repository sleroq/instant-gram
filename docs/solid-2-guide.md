# Solid 2 frontend

**Status:** current runtime and authoring conventions. State ownership and
feature evolution are governed by the
[application architecture contract](application-architecture.md).

The production `ui.html` uses `solid-js` and `@solidjs/web` 2.0.0-rc.7 with
`@solidjs/vite-plugin` 3.0.0-next.41, TypeScript 6.0.3, and Vite 8.1.3. TypeScript
preserves JSX with `@solidjs/web` as its JSX source, and the Vite plugin is
scoped to `entrypoints/ui/**`. Run `npm run dev` or build the ordinary extension
with `npm run build`; there is no preview gate or alternate output.

Components import reactive primitives from `solid-js` and DOM rendering from
`@solidjs/web`, retain reactive props, use draft store setters, stable keyed
`<For>` rows, and `<Show>` for conditionals. Removed Solid 1 APIs are not allowed.

The UI consumes complete, bounded worker snapshots with one normalized entity
dictionary shared by inbox and selected/retained history resources. Dictionary
reconciliation preserves unchanged records and rows. In the current R1 slice,
refresh is explicit; R2.11 replaces routine manual refresh with worker-owned
interest-driven synchronization while retaining refresh only as a repair affordance.
The fixed 72px inbox mounts at most 31 rows and history mounts at most 80.
Routes and logical scroll/focus restoration are window state, not a second
cache. Message previews do not imply a modal player or media-info API. Polling
and mutations remain later milestones.

Effects separate reactive computation from imperative application: the first
`createEffect` callback reads and returns tracked state, while the second applies
the resulting value without adding dependencies. Use `onSettled` for lifecycle
work that must run after the initial reactive graph settles; the removed
`onMount` API is not used.

Solid batches updates automatically. Use `flush()` only at imperative or test
boundaries that must synchronously observe an update, never as routine component
update plumbing.

Oxlint configuration follows the official Solid 2 basic template at
https://github.com/solidjs/templates/blob/50736223547106aaf370a552e6daf69767f637e9/solid-v2/basic/oxlint.config.ts
with only WXT generated-output ignores added.

Run `npm run lint`, `npm test`, `npm run check`, and `npm run build` before
finishing frontend work. Formatting is available separately through
`npm run format`.
