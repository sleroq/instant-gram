# Instagram DM live communication

**Status: protocol evidence, NOT current runtime capabilities.** The production
closed provider exposes only reads under the [engine contract](engine-inbox-contract.md);
the Solid client does not poll, mark messages read, or send mutations. R2 plans
worker-owned interest-driven polling and durable paired read commands; passive
Iris/MQTT observation remains gated by fresh evidence in R5. See the
[application contract](application-architecture.md) and
[restoration checklist](solid-restoration-checklist.md). Do not restore a UI
polling loop or UI-owned reconciliation store from these protocol references.

Tracked reference capture: `examples/www.instagram.com-live-communication.har` under `docs/examples`; the request examples here are sanitized. The separately named `message-editing.har` is local, untracked evidence. Use the same common GraphQL form fields and headers as `instagram-har-useful-requests.md`; all calls below are `POST https://www.instagram.com/api/graphql`.

## Listen for new messages

- Bootstrap with `PolarisDirectInboxQuery` / `IGDThreadDetailQuery`, passing the live `device_id_for_iris_subscription`.
- Instagram web keeps DMs live through its Iris/MQTT subscription; the HAR does not include decoded WebSocket frames, but the page CSP allows `wss://edge-chat.instagram.com` and the inbox queries are named `*_for_iris_subscription`.
- No authenticated two-account session or decoded Iris/MQTT fixture establishes
  a narrow passive page-runtime event contract. Page observation requires fresh
  evidence rather than guesses about private runtime or raw frames.
- The captured no-cursor `PolarisDirectInboxQuery` and `IGDThreadDetailQuery`
  provide initial/newest snapshots (20 messages for thread detail). They are
  candidates for future worker-owned refresh, not proof that repeated requests
  expose peer updates promptly. That requires authenticated two-account
  validation. The older-only cursor query supplies history, not synchronization.
- When a message is displayed/read, Instagram sends read markers:
    - `useIGDMarkThreadAsReadMutation`, `doc_id=27356881703909995`
    - `useIGDMarkThreadAsReadValidationMutation`, `doc_id=35211594988486314`

## Send a message

`IGDirectTextSendMutation`, `doc_id=26911679871773184`:

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

## Reply to a message

Use the same `IGDirectTextSendMutation`; set:

```json
{
    "reply_to_message_id": "<target mid.$... message id>"
}
```

Everything else is the same as a normal send. In the HAR, `replied_to_client_context` and `replied_to_item_id` stayed `null`.

## React to a message

`IGDirectReactionSendMutation`, `doc_id=24374451552236906`:

```json
{
    "input": {
        "emoji": "❤",
        "item_id": "",
        "message_id": "<target mid.$... message id>",
        "reaction_status": "created",
        "thread_id": "<thread_fbid>"
    }
}
```

Use another emoji value to change/create a reaction. Revocation sends the current
emoji through the same mutation with `reaction_status: "deleted"`. The local web
capture proves the creation shape; the deletion value follows Instagram's direct
reaction contract, not a captured deletion request. Read responses carry
complete reaction arrays, including empty or timestamp-less arrays; timestamps
alone are not a reliable reconciliation basis for future mutation support.

## Edit a text message

The local, untracked `message-editing.har` captures `IGDirectEditMessageMutation`,
`doc_id=32480262318254796`, with:

```json
{
    "thread_id": "<thread_fbid>",
    "target_item_id": null,
    "body": { "sensitive_string_value": "edited text" },
    "offline_threading_id": "<client-generated numeric id>",
    "target_message_id": "<target mid.$... message id>"
}
```

The receipt is
`data.direct_edit_message_with_slide_messaging_response` and contains matching
`message_id`/`id` plus the original message `timestamp_ms`. The capture proves
text editing only, not editing of media or other message variants.
