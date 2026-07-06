export type View<T> =
    | { state: 'idle' }
    | { state: 'loading' }
    | { state: 'ready'; data: T }
    | { state: 'error'; message: string };
