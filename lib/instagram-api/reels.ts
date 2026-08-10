import type { ReelMedia } from '../domain.ts';
import {
    parseReelInfoResponse,
    parseTopLikerCandidates,
    parseViewerFollowingResponse,
} from './parsers.ts';

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
    fetchFriendship?: (userId: string) => Promise<unknown>,
): Promise<ReelMedia> {
    const payload = validateReelPayload(value);
    const mediaId = payload.mediaId ?? instagramMediaIdFromShortcode(payload.shortcode);
    const info = await fetchInfo(mediaId);
    const media = parseReelInfoResponse(info, { ...payload, mediaId });
    const candidates = parseTopLikerCandidates(info);
    if (!candidates.length || !fetchFriendship) return media;
    const followedLikers = (await Promise.all(candidates.map(async candidate => {
        try {
            const friendship = await fetchFriendship(candidate.id);
            return parseViewerFollowingResponse(friendship, candidate.id) ? candidate : undefined;
        } catch {
            // Friendship context is optional enrichment and must not hide valid media.
            return undefined;
        }
    }))).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
    return followedLikers.length ? { ...media, followedLikers } : media;
}
