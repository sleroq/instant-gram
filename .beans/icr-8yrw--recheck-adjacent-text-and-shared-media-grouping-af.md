---
# icr-8yrw
title: Recheck adjacent text and shared-media grouping after spacing polish
status: todo
type: task
priority: normal
tags:
    - solid-restoration
    - ux
    - ui-polish
created_at: 2026-10-20T19:29:43Z
updated_at: 2026-10-20T19:48:02Z
parent: icr-i2ye
blocked_by:
    - icr-gcpy
    - icr-mvlx
---

Do this only after icr-gcpy and icr-mvlx. The user expects a text message sent with a reel/post to look visually related; the text can precede or follow the share, and its actual ordering must be checked rather than assumed.

- [ ] Inspect sanitized fixtures or explicitly authorized live evidence for text-before-share and text-after-share cases; preserve message order and stable independent IDs.
- [ ] Verify that the general consecutive-sender/five-minute spacing already makes both directions look grouped. If it does, record the evidence and complete this verification task without a second renderer or heuristic.
- [ ] If a distinct visual treatment is still needed, document the observed failure and obtain approval before adding an association rule. A small timestamp gap alone does not prove that an arbitrary text message is the share's caption.
- [ ] Add focused text/share adjacency coverage as needed without merging canonical entities, changing durable sends, or introducing R3 forwarding.

icr-jce7 separately owns the known comment-before-share stage for forwarding; cross-check that feature's emitted order when it ships, without treating all near-time incoming text as a forwarding comment.
