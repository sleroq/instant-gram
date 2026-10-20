# Roadmap

## Current state

The Solid Messages client supports cached inbox/history, pagination, send/reply,
pins, read marking, and visible-interest polling. Core messaging (R2) is accepted.
Media previews are not a player. Reactions, editing, forwarding, and comments are not implemented.

Beans own requirements and acceptance. Use `beans show <id>` for details.

```text
Current messaging --> UI polish --> R3 interactions
        |
        +-----------------------> R4 media
```

R4 has its core prerequisites, but is outside the current polish pass.
R5 covers cross-cutting work that needs its consuming feature first.

## Now: messaging UI polish

Milestone: **icr-i2ye**. Finish before R3.

| Task     | Scope                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| icr-4rev | Accessible sync orbs instead of status paragraphs.                                      |
| icr-yqp8 | Floating composer and Send clouds; remove the visible Message label.                    |
| icr-mrxb | Floating chat title; share measured overlay clearance with the composer.                |
| icr-gcpy | Five-minute same-sender grouping and a stable avatar gutter.                            |
| icr-xmnd | Reply header integrated into the bubble; inline time and full-date tooltip.             |
| icr-83kg | Contextual circular Reply action with keyboard and touch access.                        |
| icr-mvlx | Media-only, aspect-aware attachments using existing preview data.                       |
| icr-omoc | Invisible resize strip with a usable pointer target and keyboard support.               |
| icr-7h98 | Bounded automatic read recovery before manual controls; remove routine Refresh buttons. |
| icr-j8fk | Adopt latest coverage only under genuine logical bottom-follow intent.                  |
| icr-mwu8 | Floating newest control with an honest new-since-leaving-bottom badge.                  |
| icr-r54z | Settings page and one shared preference/motion owner.                                   |
| icr-yp9o | Fold the sidebar into icons without losing selection, focus, or resize width.           |
| icr-0c4s | Motion-gated entrances for genuinely new tail messages.                                 |
| icr-8yrw | Recheck text/share grouping after spacing and attachment changes.                       |
| icr-f00w | Physical reorder/pin sliding; preserve fixed slots and reduced-motion support.                   |

Keep this pass narrow:

- Floating controls must not cover the newest message at bottom.
- Genuine newest followers automatically adopt refreshed coverage through worker
  newer traversal; older readers keep their anchors until deliberate forward/bottom
  navigation. Slice/projection ends are not newest intent. Do not join retained
  ranges across cursor gaps.
- Automatic recovery applies only to eligible transient reads.
  Cyclic/no-progress cursors stay gated. Unknown sends are never blindly retried.
- Keep the header Pin/Unpin action until R3 conversation menus replace it.
- Preview styling does not add media-info loading, playback, or comments.
- Settings expose only functioning controls. Motion must honor reduced-motion preferences.

## Next: R3 — message interactions

Milestone: **icr-jce7**, blocked by polish.

- **Reactions — icr-njy9:** six quick choices, add/change/remove, searchable accessible picker.
  Extend provider validation and the durable outbox, not just the UI.
- **Editing:** outgoing text within 15 minutes. Preserve drafts on cancel.
  Retire receipt overlays through explicit bounded reconciliation.
- **Forwarding:** text, reels, and posts to at most five targets.
  Persist comment/share stages per target; retry only incomplete stages.
- **Reply jumps — icr-zoba:** mounted/cache-first lookup, then serial older cursors.
  Show honest progress, install a bounded target window, and save return positions.
  Upgrade the existing newest control to pop the return stack first.
- **Menus — icr-u9ok:** pointer, keyboard, and touch access; viewport clamping,
  dismissal, focus restoration, and only supported actions.
- **Pin placement — icr-7zgg:** remove header Pin/Unpin only after conversation menus work.
- **Motion — icr-dtee:** reaction/menu animation after their functional tasks and shared settings.
- **Keys and feedback:** pane/message navigation, editor exclusions, copy post URLs,
  and actionable errors that survive pane changes.

Reply prefetch must stay bounded. Keyboard movement must not paginate.
Uncertain non-idempotent stages must not be replayed as if they failed safely.

## R4 — media, player, and engagement

Milestone: **icr-iwr9**. Use the existing attachment surface.

- Normalize account-scoped media/users/comments and shortcode lookup.
  Retain metadata through resource references; never persist media bytes.
- Load route code and media metadata on intent through the worker scheduler.
  Keep speculative work bounded and lower priority than visible/user work.
- Preserve actual-aspect geometry and thumbnails until playable content is ready.
  Inline previews never autoplay.
- Build an accessible modal and custom player: playback, seeking, quality,
  fullscreen, carousels, attached music, and blocked-playback feedback.
- Keep playback state per window. Use the shared preference owner for volume/mute.
- Refresh expired signed URLs once through a shared worker read; keep the modal mounted.
- Add lazy, paginated comments with an explicit mounted-row budget.
- Use durable commands for media like/save, comment reactions, and comment creation/replies.
  Unknown comment-create outcomes are never blindly retried.
- Show followed-liker cues only with explicit followed-relationship evidence.

Player work: **icr-1xh8**, **icr-0tpu**. Shared mute preference: **icr-mfim**.
Wheel controls (**icr-tniw**) require a discoverable opt-in or explicit target;
they must not hijack normal scrolling.

## R5 — policy and diagnostics

Milestone: **icr-kj7d**.

- **Settings configuration — icr-r54z:** choose controls/defaults when settings design
  begins, not as a present-day blocker. Speculative cache task icr-li1d is merged
  there; no cache policy has been selected. Preserve durable commands and dedup evidence.
- **Protocol diagnostics — icr-i4mm:** observe names, IDs, endpoint, and timestamp only.
  Never log tokens/message text or auto-update descriptors.
- **Live transport research — icr-qq3b:** fresh authenticated capture and two-account
  validation first. Observe Instagram's client; do not invent a raw MQTT client.
  Polling remains the shared repair authority.
- Audit friendly unavailable/unsupported states against fresh fixtures.
- Any offline account choice must be explicit and read-only until identity is verified.

Settings and initial motion already belong to polish. Do not implement a second owner here.
See [motion constraints](motion.md).

## Approved expansion: unread counts and loading

Milestone: **icr-sphm**, after polish.

- **icr-fscs:** establish server read boundaries/count evidence and exact/partial/unknown completeness.
  Unread booleans and retained entities cannot establish exact counts.
- **icr-sik0:** load unread conversations whose latest message is within a configurable
  one-month lookback. Normalized latest-message timestamps support the age check.
  Assess account-wide discovery separately; if materially complex, the authorized
  fallback considers the first 10 inbox chats (limit configurable) and loads unread
  chats among them. Keep count-evidence/settings prerequisites; decide precise
  units and toggle defaults when implementing.
- Keep loading worker-owned and bounded. Background loading must not mark messages read.

## Uncommitted scope

These need separate product and protocol decisions:

- Watch or engagement history, including privacy, retention, and Clear.
- A route rail once multiple real destinations exist.
- Requests/Spam, richer thread actions, stickers, composer trays, and richer sends.
- Typing/online/remote-seen indicators, uploads, unsend, search, mute, and new conversations.

Do not add empty destinations or capability adapters for these proposals.
