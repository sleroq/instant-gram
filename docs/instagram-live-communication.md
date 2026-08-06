# Instagram DM live communication

Source: `examples/www.instagram.com-live-communication.har`. Use the same common GraphQL form fields and headers as `instagram-har-useful-requests.md`; all calls below are `POST https://www.instagram.com/api/graphql`.

## Listen for new messages

- Bootstrap with `PolarisDirectInboxQuery` / `IGDThreadDetailQuery`, passing the live `device_id_for_iris_subscription`.
- Instagram web keeps DMs live through its Iris/MQTT subscription; the HAR does not include decoded WebSocket frames, but the page CSP allows `wss://edge-chat.instagram.com` and the inbox queries are named `*_for_iris_subscription`.
- Practical implementation path: keep an Instagram anchor tab open and listen in the page context to the app's live thread updates, or poll `IGDThreadDetailQuery` as a fallback using the newest seen message id/timestamp for de-dupe.
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
reaction contract and is reconciled only from the mutation's authoritative array.
