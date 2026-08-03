export function getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) throw error;
    return error.message;
}

export function createSerialTaskQueue() {
    let tail: Promise<unknown> = Promise.resolve();
    return function enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = tail.then(task);
        tail = run.catch(() => undefined);
        return run;
    };
}
