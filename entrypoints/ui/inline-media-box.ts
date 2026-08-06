const MAX_MEDIA_SIZE = 300;
const MIN_MEDIA_AXIS = 1;

export type InlineMediaBox = {
    width: number;
    height: number;
};

export function calculateInlineMediaBox(sourceWidth: number, sourceHeight: number): InlineMediaBox {
    const largestSourceAxis = Math.max(sourceWidth, sourceHeight);
    const normalizedWidth = sourceWidth / largestSourceAxis;
    const normalizedHeight = sourceHeight / largestSourceAxis;
    // Chromium rounds subnormal aspect-ratio terms to zero. Clamp the fitted box
    // continuously at one CSS pixel so every accepted ratio remains renderable.
    const fittedWidth = Math.max(MIN_MEDIA_AXIS, normalizedWidth * MAX_MEDIA_SIZE);
    const fittedHeight = Math.max(MIN_MEDIA_AXIS, normalizedHeight * MAX_MEDIA_SIZE);

    return { width: fittedWidth, height: fittedHeight };
}
