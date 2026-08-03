# Teact in ICR

This is the application guide to the small Teact runtime in
[`vendor/teact`](../vendor/teact). Read it before changing TSX, component
lifecycle, or list rendering. It describes the code that is vendored here, not
current Telegram Teact and not React in general.

## Status, provenance, and boundary

Teact is a lightweight React-shaped virtual-DOM runtime. ICR uses it to keep the
extension UI small while retaining function components, hooks, TSX, and the
list-reconciliation technique needed by the inbox. The vendored code is derived
**only** from MIT-licensed
[`Ajaxy/teact@c822425`](https://github.com/Ajaxy/teact/tree/c822425ca286466c51d04e35fe2acff506437ee5).
Its MIT notice is preserved in [`vendor/teact/LICENSE`](../vendor/teact/LICENSE),
and local runtime reductions are recorded in
[`vendor/teact/README.md`](../vendor/teact/README.md).

This is separate from Telegram Web A (`Ajaxy/telegram-tt`), which is GPL-3.0-or-
later. ICR independently implements a few observed architectural ideas; it does
not vendor Telegram application source, styles, icons, or assets. Do not move
GPL material across that boundary. See
[`frontend-architecture.md`](./frontend-architecture.md#provenance-and-clean-room-boundary).

The local fork deliberately removed FasterDOM, generalized schedulers, heavy-
animation integration, and the original debug overlay. It has one
`requestAnimationFrame` update pass. Do not assume an API seen in Telegram's
current Teact exists here.

## Build and runtime wiring

- WXT supplies Vite and discovers [`entrypoints/ui/index.html`](../entrypoints/ui/index.html).
  That page loads `main.tsx` and owns the single `#app` mount node.
- [`tsconfig.json`](../tsconfig.json) uses `"jsx": "react-jsx"` and
  `"jsxImportSource": "teact"`. TypeScript therefore injects imports from
  `teact/jsx-runtime` for ordinary TSX.
- The TypeScript path `teact/*` and the Vite alias `teact` both resolve to
  `vendor/teact/src/teact`. Keep both aliases aligned.
- `@types/react` supplies JSX and event *types only*. React is not installed or
  shipped as the runtime.
- [`main.tsx`](../entrypoints/ui/main.tsx) explicitly creates the root element
  and calls `TeactDOM.render`. Application components normally use TSX and
  import hooks directly from the vendored `teact.ts`, following existing code.
- SCSS is compiled by Vite through Sass. Global UI styles currently enter once
  from `main.tsx`.

Minimal mount:

```tsx
import { createElement } from '../../vendor/teact/src/teact/teact';
import TeactDOM from '../../vendor/teact/src/teact/teact-dom';

const root = document.getElementById('app');
if (!root) throw new Error('UI root was not found');
TeactDOM.render(createElement(App, { store }), root);
```

`TeactDOM.render(undefined, root)` removes the mounted virtual tree and runs
unmount cleanup. There is no `createRoot`, hydration, portals, or server
renderer.

## Components and TSX

Components are ordinary functions. `FC<P>` is `(props: P) => any`; explicit
props types are preferable because the base `Props` type is intentionally
loose.

```tsx
type RetryProps = {
    label: string;
    onRetry: () => void;
    children?: TeactNode;
};

function RetryNotice({ label, onRetry, children }: RetryProps) {
    return (
        <section role="alert">
            <strong>{label}</strong>
            {children}
            <button type="button" onClick={onRetry}>Retry</button>
        </section>
    );
}
```

### Children, fragments, conditionals, and lists

- JSX children are assigned to `props.children`. One child is passed directly;
  multiple children are an array. Nested arrays are flattened while building
  the virtual tree.
- `<>...</>` uses Teact's `Fragment`. Empty fragments are represented by a
  comment so their position survives updates.
- `undefined`, `null`, `false`, and empty strings become empty placeholders.
  `0` is text. Unlike React, bare `true` becomes the text `"true"`; use an
  explicit conditional rather than rendering a boolean.
- Function components may return one element, a fragment, an array, text, or an
  empty value. Keep return shape predictable across renders.
- Use stable domain IDs as `key`, never a changing cursor or array index. In
  normal reconciliation, keys distinguish same-position tags/components; they
  do not provide React's general keyed-move algorithm. Key-aware insertion and
  reordering is supplied only by `teactFastList`.
- A component is preserved only when its function identity and key are equal.
  Defining a component function inside another render changes its identity and
  remounts it, so define components at module scope.

```tsx
<>
    {error && <p role="alert">{error}</p>}
    {ids.map(id => <ChatRow key={id} thread={byId[id]} />)}
</>
```

### DOM props, styles, refs, and events

- Use `className`. Most HTML properties are assigned as DOM properties;
  `data-*`, `aria-*`, `role`, `dir`, and `form` are attributes. SVG uses
  attributes and the SVG namespace.
- `style` accepts a CSS string or a camel-cased object. An object update clears
  the complete style attribute before assigning the new object, so always pass
  the complete declarative inline style. Prefer SCSS classes. For CSS custom
  properties use a style string or the low-level `setExtraStyles` helper.
- `dangerouslySetInnerHTML={{ __html }}` writes directly to `innerHTML`. It has
  no sanitizer; never use it for Instagram or other external content.
- A DOM `ref` may be a `RefObject` or callback. On a retained element update the
  old ref receives `undefined`, then the new ref receives the element. Object
  refs also invoke optional `onChange`; do not assume a ref callback runs only
  on mount/unmount.
- Event props use `onClick`, `onScroll`, `onKeyDown`, and capture suffixes such
  as `onClickCapture`. Most bubbling handlers are delegated from `document`;
  scroll, mouse enter/leave, load/error, captures, video, and iframe handlers
  are attached directly. Delegated `currentTarget`, `stopPropagation`, and
  `preventDefault` are provided through an event proxy.
- `onDoubleClick` maps to `dblclick`; focus/blur map to `focusin`/`focusout`.
  `onChange` on non-`select` controls maps to `input`.
- Controlled `input`, `textarea`, and `select` values/checked state are restored
  after handlers and attempt to preserve text selection. `defaultValue` and
  `defaultChecked` are applied only when truthy at mount, so do not rely on a
  falsy default being explicitly written.

Use React event types only as compile-time types:

```tsx
import type { UIEvent } from 'react';

<div onScroll={(event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
}} />
```

## Hooks and component APIs

Hooks are positional. Call them unconditionally and in the same order on every
render. Teact has no lint/runtime guard that can repair a changed hook order.
State, effects (including layout/unmount effects), memos, and refs each maintain
their own cursor, except all effect variants share the effect cursor.

### `useState`

```ts
useState<T>(): [T | undefined, StateHookSetter<T | undefined>]
useState<T>(initial: T | (() => T), debugKey?: string): [T, StateHookSetter<T>]
type StateHookSetter<T> = (value: T | ((current: T) => T)) => void
```

The initializer runs once. Setters compare with strict `===`, accumulate
functional updates against the pending `nextValue`, and batch the component into
the next animation-frame pass. The value visible in the current closure does not
change synchronously. A setter after unmount is ignored.

```tsx
const [attempt, setAttempt] = useState(0);
const retry = () => setAttempt(current => current + 1);
```

Do not mutate a state object and pass the same reference: the update is skipped.
The current app keeps domain state in its external store and uses a version
counter to request a Teact render.

### `useEffect`

```ts
useEffect(
    effect: () => void | (() => void),
    dependencies?: readonly unknown[],
    debugKey?: string,
): void
```

No dependency array schedules after every render; `[]` schedules once. Other
dependencies use positional strict inequality. Cleanup runs before the next
scheduled effect and synchronously on unmount. Normal effects are queued into a
request-animation-frame pass; they are not React's exact post-paint contract.

Important local caveat: effect comparison does not compare dependency-array
length. Keep a constant dependency shape; shrinking an array while preserving
its prefix may not schedule the effect. As in React, closures go stale when a
used value is omitted.

```tsx
useEffect(() => {
    const unsubscribe = store.subscribe(forceRender);
    return unsubscribe;
}, [store]);
```

### `useLayoutEffect`

```ts
useLayoutEffect(effect, dependencies?, debugKey?): void
```

It has the same dependency and cleanup rules, but queued layout cleanups/effects
run immediately after Teact commits DOM updates. Use it for read-after-write
measurement and scroll-anchor correction, not network calls or routine store
subscriptions. Initial layout effects run after the initial root DOM commit.

### `useUnmountCleanup`

```ts
useUnmountCleanup(cleanup: () => void): void
```

Registers the cleanup once at that effect cursor and runs it on unmount. It does
not react to changing callback captures. Prefer a normal effect cleanup when the
resource depends on props; use this only for a stable lifetime cleanup.

### `useMemo` and `useCallback`

```ts
useMemo<T>(resolver: () => T, dependencies: readonly unknown[],
    debugKey?: string, debugHitRateKey?: string): T
useCallback<F extends AnyFunction>(callback: F, dependencies: unknown[],
    debugKey?: string): F
```

`useMemo` computes on first render and when dependency length or any dependency
changes by `!==`. `useCallback` is `useMemo` for a function. These are
performance tools, not semantic guarantees; dependencies must still be complete.

```tsx
const visibleIds = useMemo(
    () => ids.slice(window.start, window.end),
    [ids, window.start, window.end],
);
```

### `useRef`

```ts
useRef<T>(initial: T): RefObject<T>
useRef<T>(): RefObject<T | undefined>
type RefObject<T> = { current: T; onChange?: () => void }
```

The same mutable object is returned each render and changing `current` does not
render. Teact clears ref contents during component unmount. DOM refs follow the
extra update callbacks described above.

```tsx
const scrollerRef = useRef<HTMLDivElement>();
<div ref={scrollerRef} className="messages" />
```

### `memo`

```ts
memo<T extends FC>(Component: T, debugKey?: string): T
```

The wrapper memoizes a created component element against `Object.values(props)`.
This is shallow, depends on stable property enumeration, and has no custom
comparison function. New callback/object props miss the memo. Use it for hot,
identity-stable rows; do not wrap every component by default.

### Context and signals

```ts
createContext<T>(defaultValue?: T): Context<T>
useContextSignal<T>(context: Context<T>): Signal<T>
useSignal<T>(initial?: T): readonly [Signal<T>, (value: T) => void]
```

`Context.Provider` accepts `{ value, children }`. Unlike React's `useContext`,
`useContextSignal` returns a getter signal: read it with `getValue()`. Provider
values are propagated as signals, not by a general context-driven rerender.

`useSignal` creates a stable component-owned pair. A signal is a callable getter
with `subscribe(callback)` and `once(callback)`; its setter compares with `===`
and invokes subscribers synchronously. Passing a signal itself in an effect's
dependency list subscribes that effect to setter calls:

```tsx
const [getOnline, setOnline] = useSignal(false);

useEffect(() => {
    document.title = getOnline() ? 'Online' : 'Offline';
}, [getOnline]);
```

Signal dependencies are subscribed only when that effect slot is first created.
Do not replace one signal object with another in the same slot. Reading a signal
in render does **not** by itself make the component reactive in this reduced
runtime. The external normalized store remains the app's state source of truth;
do not introduce signals merely to create a second state model.

The lower-level utility module exports:

```ts
createSignal<T>(initial?): readonly [Signal<T>, (value: T) => void]
isSignal(value): value is Signal
cleanupEffect(callback): void
```

`createSignal` is useful only for state whose lifetime is managed outside a
component. Always retain and call subscription disposers. `cleanupEffect`
unsubscribes a callback from all signals and is infrastructure-level; normal app
code should use returned disposers or effect cleanup.

### Element creation and types

`createElement(source, props, ...children)` and `Fragment` back the JSX runtime
and are exported both as named values and on the default `Teact` object. Useful
types include `FC`, `Props`, `TeactNode`, `StateHookSetter`, `RefObject`,
`ElementRef`, `Context`, and virtual-element types.

`VirtualType`, `MountState`, `isParentElement`, `hasElementChanged`,
`renderComponent`, `mountComponent`, `unmountComponent`, and
`captureImmediateEffects` are exported because `teact-dom.ts` composes the
runtime from source modules. They are renderer internals, not application APIs;
calling them bypasses DOM ownership and scheduling invariants. Likewise
`DEBUG_resolveComponentName`, `dom-events.ts`, `safeExec`, callback managers,
and debug utility exports are implementation support, not extension patterns.

## Rendering and reconciliation

Each JSX expression creates a virtual tag, component instance, fragment, text,
or empty node. On update:

1. State setters add component instances to a set and schedule one animation
   frame.
2. The frame snapshots pending work, runs normal effect cleanups/effects, commits
   pending state values, then updates components in mount-ID order.
3. Components execute and return a new virtual subtree. Same tag+key or same
   component function+key is updated; a different identity remounts.
4. Ordinary children reconcile by index. Added runs are built in a
   `DocumentFragment`; empty fragments retain a comment marker.
5. Layout cleanups/effects run after DOM mutation.

Returning the exact same rendered virtual value from a mounted component skips
its subtree update. Error handling logs render/effect failures and, for a render
failure, retains the prior rendered value. There are no error boundaries,
Suspense, concurrent rendering, Strict Mode double invocation, transitions, or
automatic batching outside the local animation-frame scheduler.

### `teactFastList`

`teactFastList` opts one DOM parent into key-aware list reconciliation optimized
for batches inserted at the beginning/end and selectively moved retained nodes.
It is why the virtualized inbox can replace a bounded ID window while preserving
matching row DOM:

```tsx
<div className="chat-list__spacer" teactFastList>
    {visibleIds.map((id, offset) => (
        <ChatRow key={id} index={start + offset} thread={byId[id]} />
    ))}
</div>
```

Rules and source-observable caveats:

- Every direct child needs a unique, stable key. Missing/duplicate keys fall
  back to synthetic index keys. Diagnostics and the duplicate-key exception are
  gated by the currently disabled `DEBUG` constant, so production may fail
  silently if this rule is broken.
- Direct fragments are unsupported. The explicit exception is also debug-only;
  do not depend on release behavior.
- Fast-list matching applies to direct children only. Keep loading affordances
  outside the optimized row parent.
- `teactOrderKey` can signal a deliberate reorder of a retained child. It is a
  niche optimization, requires a `teactFastList` parent, and its truthiness-based
  branch makes `0` unsuitable. The current app does not need it: pin ordering
  plus absolute row transforms is enough.
- This is not a virtualizer. The caller still computes a bounded ID window and
  positions rows. It also is not suitable for variable-height message-history
  geometry by itself.

## TeactDOM extras

The default export exposes only `TeactDOM.render(element | undefined, root)`.
The module also exports `addExtraClass`, `removeExtraClass`,
`toggleExtraClass(element, className, force?)`, and
`setExtraStyles(element, styles)`. These preserve imperative classes/styles
across later declarative prop updates. They are intended for exceptional
imperative integrations; prefer TSX props and SCSS. `setExtraStyles` accepts CSS
custom-property keys and reapplies the complete stored extra-style object.

## Differences from React that matter

Do not install a React library or paste a React ecosystem pattern without
checking this runtime.

- React packages are present only for types. React hooks, ReactDOM, DevTools,
  context consumers, portals, lazy/Suspense, error boundaries, and React testing
  renderers are unavailable.
- Child reconciliation is positional unless the parent has `teactFastList`.
  A key alone does not enable general keyed movement.
- Bare `true` renders as text.
- State commits on the next animation frame and equality is strict `===`.
- Effect timing and dependency-length behavior differ as documented above.
- Context/signal reads do not automatically rerender a component.
- `memo` compares `Object.values(props)`, not React's full memo behavior, and has
  no comparator.
- Ref callbacks can receive `undefined` and the same element during an ordinary
  retained-element update.
- There is no synthetic-event pooling, but delegated events are proxies and
  delegation stops before `document.body`.
- `style` objects replace all declarative inline styles rather than diffing
  individual properties.
- Hook misuse is not diagnosed. Keep hooks top-level and constant-order.
- Development `DEBUG` and `DEBUG_MORE` are hard-coded false; do not rely on
  runtime warnings to catch key or performance mistakes.

## App conventions

### State and extension boundaries

- Keep entities and async ownership in `entrypoints/ui/store.ts`, not component
  hook islands. Components select normalized IDs/entities and dispatch actions.
- Keep transport in `entrypoints/ui/rpc.ts` and contracts in `lib/domain.ts`.
  Components must not know Instagram query documents, cookies, or HAR shapes.
- Subscribe once at the root (`useStore` in `App.tsx`) and clean up on unmount.
  Async store actions own single-flight and stale-response checks.
- Preserve bounded rendering. Inbox rows are fixed 72px absolute rows in a
  full-height spacer. Variable-height history requires its own bounded window
  and anchor logic; see [`frontend-architecture.md`](./frontend-architecture.md).

### Styling and accessibility

- Put reusable presentation in `styles.scss`; reserve inline styles for dynamic
  geometry such as spacer height and row transform.
- Reuse the SCSS tokens and BEM-like class naming already present. Animate only
  transform/opacity, reserve media/avatar dimensions, and retain the
  `prefers-reduced-motion` override.
- Use semantic buttons for actions, explicit `type="button"`, visible
  `:focus-visible`, `role="status"` for loading, and `role="alert"` for errors.
  Expose selection (`aria-pressed` or an appropriate selected-state pattern).
- Decorative images have empty alt text; meaningful media needs an accessible
  name. Do not use glyph-only state without an accessible row label.
- Preserve keyboard scrolling/focus when virtual windows move. Never put
  interactive controls inside another button.

### Debugging and testing

1. Inspect the actual vendored source when behavior differs from React; upstream
   current Teact may not match this pinned fork.
2. Check stable keys, component function identity, and hook order first when
   state appears to reset.
3. For a missed render, check strict-reference equality and whether external
   store mutation emitted. For an extra render, check fresh callback/object
   props and `memo` dependencies.
4. For an effect loop or stale closure, inspect the constant-shaped dependency
   list and cleanup. For measurement bugs, move DOM correction to
   `useLayoutEffect`.
5. For list corruption, verify unique direct-child IDs and ensure fragments are
   absent under `teactFastList`.
6. Use browser DOM/performance tools for component behavior. Node tests exercise
   store/window behavior, and the focused Vite+Playwright harness mounts the
   production App for history sentinel and anchor regressions.

Run the repository checks after frontend changes:

```sh
npm test
npm run check
npm run build
git diff --check
```

## Recipe: add a component or feature safely

1. Read [`frontend-architecture.md`](./frontend-architecture.md), identify the
   owner (domain contract, RPC, store, window helper, component, or SCSS), and
   confirm whether the behavior is implemented now or reserved for Milestone 2.
2. Extend `lib/domain.ts` only for a real background/UI contract. Keep external
   Instagram validation and parsing outside the component tree.
3. Add normalized data and one action to the existing store. Define loading,
   error, retry, single-flight, stale-response, and teardown behavior at that
   boundary; do not create a second per-component cache.
4. Create a module-scope typed function component. Pass IDs or stable entities
   and stable callbacks where practical. Keep hooks unconditional.
5. Render lists with stable domain keys. Use `teactFastList` only for a measured
   keyed DOM list whose direct children meet its rules; separately bound the
   rendered ID window.
6. Add semantic loading/error/empty UI and keyboard/accessibility behavior.
   Place dynamic geometry inline and normal visuals in SCSS; reserve dimensions
   and honor reduced motion.
7. Add a focused pure test when changing state merging, cursor gating,
   generation handling, ordering, or window boundaries. DOM anchor behavior
   requires a browser-level regression in the focused Vite+Playwright harness.
8. Run the four checks above and manually exercise `/ui.html` in the extension
   for DOM, focus, scroll, and network timing behavior.
