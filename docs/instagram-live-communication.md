# DM transport and interaction evidence

Use the [protocol reference](instagram-methods.md) for common request/auth fields
and shipped descriptors. Transport research belongs in the worker/provider
boundary, never a UI-owned protocol or polling adapter.

## Passive transport evidence gate

- `examples/www.instagram.com-live-communication.har` has no decoded WebSocket
  frames. CSP permits `wss://edge-chat.instagram.com`; inbox names include
  `for_iris_subscription`. These are Iris/MQTT clues, not a usable event contract.
- Before implementing page observation, capture two authenticated accounts and
  identify a narrow passive signal from Instagram's own client. Record redacted
  payload structure, account identity, subscription lifecycle, reconnect and
  teardown behavior. Do not guess private runtime callbacks or raw-frame formats.
- No-cursor inbox/thread queries return newest snapshots; older-only pagination
  is not synchronization. Two-account tests must establish peer-update visibility
  and latency; neither capture presence nor retained history proves freshness.

## Send and reply wire shape

`IGDirectTextSendMutation` (`26911679871773184`) uses:

```json
{
    "ig_thread_igid": "<thread_fbid>",
    "offline_threading_id": "<client-generated numeric id>",
    "recipient_igids": null,
    "replied_to_client_context": null,
    "replied_to_item_id": null,
    "reply_to_message_id": null,
    "sampled": null,
    "text": { "sensitive_string_value": "message text" },
    "mentions": [],
    "mentioned_user_ids": [],
    "commands": null,
    "forwarded_from_thread_id": null,
    "is_forwarded_from_own_message": null,
    "send_attribution": "igd_web_chat_tab:in_thread"
}
```

Reply sets `reply_to_message_id` to the target opaque `mid.$…` ID; the two other
reply fields remain null. Receipt identity checks are in the protocol reference
and shipped mutator, not implied by HTTP success.

## Future reactions

`IGDirectReactionSendMutation` (`24374451552236906`):

```json
{
    "input": {
        "emoji": "❤",
        "item_id": "",
        "message_id": "<target mid.$…>",
        "reaction_status": "created",
        "thread_id": "<thread_fbid>"
    }
}
```

Creation is captured. Revocation with the current emoji and
`reaction_status:"deleted"` follows the direct reaction contract but lacks a
captured deletion request; obtain evidence before implementing it. Read responses
contain complete reaction arrays, including empty or timestamp-less arrays;
timestamps alone are not a reconciliation contract.
