const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;

export async function loadTrustedProfileImageDataUrl(
    source: string,
    fetchImage: typeof fetch = fetch,
): Promise<string> {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.cdninstagram.com'))
        throw new Error('Untrusted Instagram profile image URL');

    const response = await fetchImage(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Instagram profile image failed with ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0];
    if (!contentType?.startsWith('image/'))
        throw new Error('Instagram profile image returned invalid media');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROFILE_IMAGE_BYTES)
        throw new Error('Instagram profile image was too large');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PROFILE_IMAGE_BYTES)
        throw new Error('Instagram profile image was too large');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return `data:${contentType};base64,${btoa(binary)}`;
}
