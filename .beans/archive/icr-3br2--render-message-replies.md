---
# icr-3br2
title: Render message replies
status: completed
type: milestone
priority: high
tags:
    - dm
    - replies
created_at: 2026-07-04T16:57:40Z
updated_at: 2026-08-03T13:17:24Z
blocked_by:
    - icr-9qjx
---

Large milestone for making replies first-class in parsed messages and rendered bubbles.

## Scope

Render quoted reply context for existing messages before implementing reply sending.

## Checklist

- [ ] Extend message parsing to turn `replied_to_message` into a compact reply preview, not only an id.
- [ ] Update `Message` domain types to support reply previews on text, reel-share, and unsupported messages where applicable.
- [ ] Extract message bubble rendering into a component that can show reply preview + body content.
- [ ] Add a small `ReplyPreview` UI with sender/text-or-reel summary and sensible fallback for unsupported quoted content.
- [ ] Ensure existing reel-share open behavior still works from normal messages.
- [ ] Verify old history pages and newly loaded older messages render with replies consistently.
- [ ] Verify with `npm run check` and manual thread inspection.

## Notes

This milestone is display-only. Do not add composer/reply sending here.



## Completion evidence

Reply previews are parsed in `ig-anchor.content.ts` and rendered by the Teact `ReplyPreview` in `App.tsx`; the broader completed `icr-vlgo` records the same delivered UX. This Svelte-era display milestone is therefore complete.
