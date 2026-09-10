# Inbox engine contract

The production worker owns one account-partitioned `inbox:primary` resource: only the
first server page, normalized as ordered thread IDs and thread, user, and message
dictionaries. IndexedDB replaces that account's retained facts atomically and
increments one global commit revision. Media bytes, history, pagination,
mutations, polling, replay logs, and offline account selection are excluded.

Every client Port receives complete snapshots, not deltas. Sequence numbers are
contiguous only for that Port. A gap, worker epoch change, or disconnect clears
client state and establishes a fresh subscription. Duplicate snapshots are
ignored. An account epoch change clears the inbox subtree, then consumes the
authorized snapshot in the same stream. Solid reconciles dictionaries within an
authorized account epoch, but never preserves an inbox subtree across epochs.

The engine verifies the current Instagram `ds_user_id` through the selected
content provider before reading or publishing cached data. Cache is delivered
only after that evidence and is marked stale while the provider refresh runs.
Authentication failure clears account data; ordinary provider/protocol/storage
failures after identity retain authorized cache. Cookie evidence reduces account
disclosure risk but cannot prove that every mid-request switch is observable.

Repository and engine tests use native IndexedDB semantics through
`fake-indexeddb` and mocked providers. They do not exercise live Instagram.

The only client page is `/ui.html`; this contract intentionally provides no
history, media, pagination, or mutation capability.
