import { createSignal, Show } from 'solid-js';
import type { Message } from '../../lib/domain';
import { MAX_SEND_TEXT_LENGTH } from '../../lib/engine/operations';
import type {
    MutationIntent,
    OperationResult,
} from '../../lib/engine/operations';

export type ThreadDraft = { text: string; replyTo?: string; version: number };

export function Composer(props: {
    threadId: string;
    draft: ThreadDraft;
    update(draft: ThreadDraft): void;
    reply: Message | undefined;
    mutate(intent: MutationIntent): Promise<OperationResult>;
    beforeSend(): void;
}) {
    const [error, setError] = createSignal('');
    let composing = false;

    async function submit() {
        const submitted = { ...props.draft };
        if (!submitted.text.trim()) return;
        if (submitted.text.length > MAX_SEND_TEXT_LENGTH) {
            setError(
                `Messages must be ${MAX_SEND_TEXT_LENGTH} characters or fewer.`,
            );
            return;
        }
        const threadId = props.threadId;
        props.beforeSend();
        setError('');
        const result = await props.mutate({
            type: 'send',
            threadId,
            text: submitted.text,
            replyTo: submitted.replyTo,
        });
        if (!result.ok) {
            setError(result.error.message);
            return;
        }
    }
    return (
        <form
            class="solid-composer"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <Show when={props.draft.replyTo}>
                <div role="status">
                    Replying to{' '}
                    {props.reply?.kind === 'text'
                        ? props.reply.text
                        : 'message'}{' '}
                    <button
                        type="button"
                        onClick={() =>
                            props.update({
                                text: props.draft.text,
                                version: props.draft.version + 1,
                            })
                        }
                    >
                        Cancel reply
                    </button>
                </div>
            </Show>
            <label>
                Message
                <textarea
                    aria-label="Message"
                    maxlength={MAX_SEND_TEXT_LENGTH}
                    value={props.draft.text}
                    onInput={(event) =>
                        props.update({
                            ...props.draft,
                            text: event.currentTarget.value,
                            version: props.draft.version + 1,
                        })
                    }
                    onCompositionStart={() => {
                        composing = true;
                    }}
                    onCompositionEnd={() => {
                        composing = false;
                    }}
                    onKeyDown={(event) => {
                        if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.isComposing &&
                            !composing
                        ) {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                />
            </label>
            <button type="submit" disabled={!props.draft.text.trim()}>
                Send
            </button>
            <Show when={error()}>
                <p role="alert">{error()}</p>
            </Show>
        </form>
    );
}
