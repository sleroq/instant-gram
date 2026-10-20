# Instant Gram

A lightweight Instagram messaging client for Chromium.
Built to feel fast, even when Instagram's API is slow.

An IndexedDB-backed engine keeps loaded conversations close.
Cached messages stay visible during sync.
Sends get instant feedback, then durable delivery tracking.

```text
[Solid UI] <--> [Worker engine] <--> [Instagram API]
                      |
                 [IndexedDB]
```

Today: conversations, history, send/reply, pins, read state, and automatic updates.
Next: UI polish, richer interactions, and media playback.

## Try it

Requires Bun 1.3.13 or newer.

```sh
bun install --frozen-lockfile
bun run build
```

Load `.output/chrome-mv3` as an unpacked extension in `chrome://extensions`.
Keep an Instagram tab open and logged in.

[Development](docs/development.md) · [Architecture](docs/application-architecture.md) · [Roadmap](docs/roadmap.md)
