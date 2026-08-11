# Instagram DM live communication

Source: `examples/www.instagram.com-live-communication.har`. Use the same common GraphQL form fields and headers as `instagram-har-useful-requests.md`; all calls below are `POST https://www.instagram.com/api/graphql`.

## Listen for new messages

- Bootstrap with `PolarisDirectInboxQuery` / `IGDThreadDetailQuery`, passing the live `device_id_for_iris_subscription`.
- Instagram web keeps DMs live through its Iris/MQTT subscription; the HAR does not include decoded WebSocket frames, but the page CSP allows `wss://edge-chat.instagram.com` and the inbox queries are named `*_for_iris_subscription`.
- Practical implementation path: keep an Instagram anchor tab open and listen in the page context to the app's live thread updates, or poll `IGDThreadDetailQuery` as a fallback using the newest seen message id/timestamp for de-dupe.
- The extension currently uses that fallback. No authenticated two-account
  session or decoded Iris/MQTT fixture was available to prove a narrow passive
  page-runtime event contract, so implementing a page observer would have meant
  guessing at private runtime or raw frame behavior. While the UI is visible it
  polls the captured initial `PolarisDirectInboxQuery` and, when a loaded thread
  is selected, the captured initial `IGDThreadDetailQuery`. Repeating the
  no-cursor request is structurally the authoritative initial/newest 20-message
  shape, so it is the safest permitted fallback; whether repeated live requests
  expose peer updates promptly is not yet verified and requires authenticated
  two-account validation. The older-only cursor query is never used for
  synchronization. Both responses are already normalized by the anchor parsers
  and only protocol-neutral entities cross into the UI store.
- Polling starts after a 5-second interval, is single-flight, pauses completely
  while the UI document is hidden, and refreshes immediately when it becomes
  visible. Failures use exponential 10/20/40/60-second retry delays (capped at
  60 seconds); a successful combined inbox/thread snapshot resets the delay. A
  timer or visibility refresh that finds an ordinary inbox initial/pagination
  read in flight schedules one replacement attempt at the current delay, rather
  than issuing a duplicate request or stopping the loop.
  Teardown removes the visibility listener, clears the timer, and generation-
  gates any request already in flight. Incoming peer read-receipt updates and
  typing remain unsupported; selected unread conversations do send the captured
  read pair. Passive Iris/MQTT observation and manual two-account validation
  remain future live-session work.
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
Read responses also carry complete authoritative arrays: accepted empty or
timestamp-less arrays may remove/replace earlier reactions. The UI rejects stale
overlapping reads by request ownership and local reaction revisions, not by
comparing reaction timestamps.

## Edit a text message

`docs/message-editing.har` captures `IGDirectEditMessageMutation`,
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
text editing only; media and other message variants are not exposed as editable.
