---
# icr-4gws
title: Make shared posts media-forward in history
status: completed
type: feature
priority: high
tags:
    - history
    - reels
    - ui
    - discovered
created_at: 2026-08-06T14:48:04Z
updated_at: 2026-08-06T15:07:19Z
parent: icr-61iz
---

Restructure shared-reel/post history markup and SCSS without altering normalized entities, viewport limits, or scroll anchoring.

Scope:

- Render author avatar/icon and author name at the post top-left; use a single-line overflow-safe label (ellipsis) for long names.
- Treat a shared post as media/content, not a generic message bubble: remove its outer card/bubble border, background, padding, and artificial right/bottom whitespace while retaining an accessible focus treatment.
- Keep date separators as history-level grouping UI. Place per-post time as an absolute bottom-right overlay inside the visual post; reveal only on hover/focus-within and keep it out of normal layout.
- Move grouped reaction chips to a sibling below the post/content rather than a child inside its surface. Preserve outgoing/incoming alignment, accessible labels, failure state, reduced motion, and reply context.
- Verify variable media geometry continues to reserve dimensions and does not regress the history anchor.

Acceptance: a long author name never expands the post; shared post media has no visible enclosing border or empty bubble gutter; reaction chips are visibly below it; timestamp consumes no layout space and is visible only while the row is hovered/focused; text/reply/unsupported rows retain their established presentation.

Completed 2026-08-06: shared reel/inline rows now use borderless media surfaces with compact overflow-safe author identity, reaction chips below content, and hover/focus-only overlaid timestamps. Existing reply/date/anchor behavior is preserved and covered in the production browser harness.

Manual-feedback remediation: inline reel media now reserves the exact source
ratio inside the existing 300×300 bound (9:16 is 168.75×300), eliminating
portrait side bars while retaining bounded rows and resize-anchor correction.
Reel-author avatars are fetched through the background's bounded trusted-CDN
data-URL boundary so extension-page CORP does not leave broken profile images.
