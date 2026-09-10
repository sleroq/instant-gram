---
# icr-iqhf
title: Replace hover reaction button with reaction rail and full picker
status: completed
type: feature
priority: high
tags:
    - reactions
    - ui
    - accessibility
    - discovered
created_at: 2026-08-06T14:48:05Z
updated_at: 2026-08-06T15:07:19Z
parent: icr-61iz
---

Replace the single hover smiley button with a compact progressive quick-reaction rail beside a history post/message. Row hover/focus reveals only the default reaction; hovering or focusing that control expands five additional recent reactions and a final arrow/expander. Selecting a quick emoji retains the existing store-owned optimistic single-flight mutation. Selecting the arrow opens an accessible full reaction chooser.

Clean-room constraint: Telegram Web A is GPL-3.0-or-later. Use it only to validate interaction behavior; do not copy its source, CSS, icons, assets, emoji catalog, or markup. Implement local TSX/SCSS and a locally chosen emoji dataset/selector.

Scope:

- Define a small presentation-only open/close state; message entities, mutations, authoritative receipts, and error state remain in HistoryState/store.ts.
- Preserve keyboard focus return, Escape/outside dismissal, viewport clamping, disabled/busy state, long-press/context-menu access, and narrow-layout placement.
- The expanded chooser must be keyboard accessible, searchable or categorized if its emoji set is broad enough to require it, and must not mount an unbounded heavy surface for every history row.
- Add focused browser coverage for quick selection, expander/full chooser, dismissal/focus, and mutation failure display.

Acceptance: row hover/focus reveals only one small default control; pointer/focus interaction with that control progressively reveals five more reactions and More without changing message geometry; no old standalone reaction button remains; a quick reaction issues exactly one existing mutation; arrow opens the full chooser without clipping; all controls have names and keyboard paths; no copied Telegram application material enters the repository.

Completed 2026-08-06: replaced the standalone smiley with one true single-column hover/focus quick-reaction rail and categorized full chooser. The chooser uses labeled ARIA groups of radio menu items with deterministic two-dimensional arrow navigation. Both retain store-owned optimistic single-flight/error behavior, focus return, outside/Escape dismissal, viewport clamping, contextual/long-press access, and focused browser coverage.

Manual-feedback remediation: the compact state now contains only the default
reaction and expands horizontally to five additional recent choices plus More
from pointer hover or keyboard focus. Placed reaction chips are buttons: another
user's reaction adds ours, while a chip containing ours revokes it through the
same optimistic/single-flight/authoritative-receipt store path.
