export function getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) throw error;
    return error.message;
}
