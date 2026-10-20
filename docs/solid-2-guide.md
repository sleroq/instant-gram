# Solid 2

The UI uses `solid-js` and `@solidjs/web` 2.0.0-rc.7.
The Vite plugin is scoped to `entrypoints/ui/**`.
Keep dependency upgrades coordinated with the JSX compiler and lint config.

## Authoring rules

- Import reactivity from `solid-js` and rendering from `@solidjs/web`.
- Keep props reactive. Use draft setters for stores.
- Use stable keyed `<For>` rows and `<Show>` conditionals.
- Do not use removed Solid 1 APIs such as `onMount`.
- Split effects: the first `createEffect` callback reads and returns tracked state;
  the second applies it without adding dependencies.
- Use `onSettled` for work that needs the initial reactive graph to settle.
- Solid batches updates automatically. Reserve `flush()` for imperative or test
  boundaries that must synchronously observe an update.

See [UI rules](../entrypoints/ui/AGENTS.md) for state, rendering, and scroll ownership.
