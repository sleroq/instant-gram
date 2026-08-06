const MAX_MEDIA_SIZE = 300;
const MIN_MEDIA_AXIS = 1;
const MIN_PORTRAIT_WIDTH = 240;
const MIN_LANDSCAPE_HEIGHT = 80;

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

    return {
        width: expandSmallMediaAxis(fittedWidth, MIN_PORTRAIT_WIDTH),
        height: expandSmallMediaAxis(fittedHeight, MIN_LANDSCAPE_HEIGHT),
    };
}

function expandSmallMediaAxis(fittedSize: number, minimumSize: number) {
    if (fittedSize >= minimumSize) return fittedSize;

    const enlargement = minimumSize / fittedSize;
    if (enlargement <= 1.5) return minimumSize;
    if (enlargement >= 2) return fittedSize;

    const progress = (enlargement - 1.5) / 0.5;
    const smoothProgress = progress * progress * (3 - 2 * progress);
    return minimumSize + (fittedSize - minimumSize) * smoothProgress;
}
