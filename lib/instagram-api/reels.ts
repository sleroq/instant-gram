import type { ReelMedia } from '../domain.ts';
import { parseReelInfoResponse } from './parsers.ts';

type ReelPayload = { shortcode: string; mediaId?: string };

export function instagramMediaIdFromShortcode(shortcode: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(shortcode))
        throw new Error('Invalid Instagram reel shortcode');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let mediaId = 0n;
    for (const character of shortcode)
        mediaId = mediaId * 64n + BigInt(alphabet.indexOf(character));
    const value = mediaId.toString();
    if (!/^\d{1,64}$/.test(value)) throw new Error('Invalid Instagram reel media ID');
    return value;
}

export function validateReelPayload(value: unknown): ReelPayload {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid Instagram reel payload');
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).some(key => key !== 'shortcode' && key !== 'mediaId'))
        throw new Error('Invalid Instagram reel payload fields');
    if (typeof payload.shortcode !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.shortcode))
        throw new Error('Invalid Instagram reel shortcode');
    if (payload.mediaId !== undefined &&
        (typeof payload.mediaId !== 'string' || !/^\d{1,64}$/.test(payload.mediaId)))
        throw new Error('Invalid Instagram reel media ID');
    return payload as ReelPayload;
}

export async function loadReelMedia(
    value: unknown,
    fetchInfo: (mediaId: string) => Promise<unknown>,
): Promise<ReelMedia> {
    const payload = validateReelPayload(value);
    const mediaId = payload.mediaId ?? instagramMediaIdFromShortcode(payload.shortcode);
    return parseReelInfoResponse(await fetchInfo(mediaId), { ...payload, mediaId });
}
