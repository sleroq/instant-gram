# Application architecture

The extension is a local client/server system.
The MV3 worker is the server. Solid windows are disposable clients.

```text
[Solid windows] <-- interests / commands / snapshots --> [Worker engine]
                                                              |
                              +-------------------------------+
                              |                               |
                         [IndexedDB]                [Instagram provider]
                                                              |
                                                    [Content script / API]
```

## Owners

| Owner          | Responsibility                                                          | Coding rules                          |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| Solid client   | Port recovery and bounded normalized projection                         | [UI](../entrypoints/ui/AGENTS.md)     |
| Solid features | Routes, drafts, focus, logical scroll anchors, rendering                | [UI](../entrypoints/ui/AGENTS.md)     |
| Worker host    | Runtime assembly and browser callbacks                                  | [Worker](../lib/worker/AGENTS.md)     |
| Engine         | Identity, canonical facts, resources, interests, scheduling, operations | [Engine](../lib/engine/AGENTS.md)     |
| Repository     | IndexedDB migrations, transactions, references, retention               | [Engine](../lib/engine/AGENTS.md)     |
| Provider/API   | Authentication, transport, external validation, receipts                | [Provider](../lib/provider/AGENTS.md) |

- Keep one UI runtime, canonical engine, database, and closed provider surface.
- No UI-owned canonical cache, protocol, persistence, polling, or retry scheduler.
- Production uses one `ManagedRuntime` with provider, repository, and engine layers.
  Effect is pinned to `4.0.0-beta.107`; upgrades need deliberate API migration.
- Engine workflows use scoped Effects. Pure reducers and Solid use plain TypeScript.
- IndexedDB commits provide durability across worker suspension; fibers do not.

## Identity and privacy

- Partition Instagram facts, resources, and operations by verified `ds_user_id`.
- Keep account ID, message viewer, read actor, thread key, FBID, and IGID distinct.
- Verify current provider identity before publishing persisted account data.
- On account change, advance the epoch, reject obsolete work, clear client
  projections, and switch partitions without merging records.
- Unknown identity cannot reopen a cached account. Cookie evidence does not prove
  that every external account switch is observable.
- Never persist auth secrets, media bytes, or proxied data URLs.

## Reads and storage

- Normalize facts by stable domain ID. Ordered resources hold references.
- Synthetic message IDs are conversation-scoped cache keys, not provider IDs.
- Publish authorized cached content before refresh. Usable content stays visible
  during refresh/errors. Availability, freshness, and synchronization are independent.
- The worker selects opaque cursors and shares read flights across clients.
- Only exact request/response cursor links prove contiguous coverage.
  Retained entities alone prove neither ordering nor exhaustion.
- Keep previous proven history coverage separate from a refreshed head.
  Do not move older readers or join ranges across a gap.
- Retain loaded history pages. Under storage pressure, evict whole inactive
  histories while protecting interested/recent histories and referenced facts.
- Runtime and DOM limits do not authorize truncating durable history.

## Commands

- Current commands are send/reply, pin/unpin, and paired read marking.
- Use one shared pure projector for speculative and accepted overlays.
- Persist immutable account-scoped intent before dispatch. No network inside transactions.
- Deduplicate by operation ID. Reject reuse with different payloads.
- Serialize conflicting targets. Commit matching receipts, facts, and settlement together.
- Never blindly retry unknown non-idempotent outcomes.
- Mark only the latest message actually seen read. Arrivals and background loads are not seeing.
- Bound runtime operations to 200 active commands plus 200 settled send aliases.
  Persisted dedup tombstones have no expiry; database growth is a known trade-off.
- Storage failure rejects acceptance before provider dispatch.

## Client delivery

- Send complete bounded snapshots with account/worker epochs, commit revision,
  and contiguous per-client sequence. Recover gaps with a new snapshot.
- Limit history projection to 400 IDs per admitted window. Mount at most
  31 fixed 72px inbox rows and 80 history rows.
- Poll only while visible clients have interest. The worker owns synchronization.
- Keep routes, drafts, focus, and scroll anchors local to each window.
- Previews are not a player. Unread booleans/watermarks are not exact unread counts.

See [roadmap](roadmap.md) for future capabilities and
[development](development.md) for verification and performance targets.
