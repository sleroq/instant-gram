# Frontend architecture

`entrypoints/ui/index.html` is the sole production extension page and canonical
`/ui.html` browser-action destination. Its Solid 2 application renders only the
read-only primary inbox from complete worker snapshots.

The UI owns presentation, normalized dictionary reconciliation, and fixed-row
virtualization. It renders stable 72px absolute rows and mounts no more than 31.
It has explicit Refresh and Retry actions and no local entity cache, Instagram
requests, automatic retry, selection, history, media, pagination, polling, or
mutations.

`lib/engine` owns account-partitioned first-page state, IndexedDB persistence,
refresh single-flight, epochs, and snapshot sequences. `lib/provider` owns the
reverse content-script Port, Instagram anchor selection, account verification,
and closed account/inbox methods. `lib/instagram-api/inbox.ts` owns the one live
Instagram request and validates its response with the shared parser.

The broader catalog, parsers, handlers, and protocol documentation remain
independent references for future functionality; they are not exposed by the
runtime. Any future history implementation must define its own bounded rendering
and pagination contract before entering production.

See the [Solid restoration checklist](solid-restoration-checklist.md) for the
audited **planned** restoration sequence. It is a plan, not a statement that any
excluded capability is currently implemented.
