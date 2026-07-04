export type Tokens = {
    fbDtsg: string;
    lsd: string;
    jazoest: string;
    csrfToken: string;
    deviceId: string;
    viewerId: string;
};

type TokenKey = keyof Tokens;
type TokenSources = Partial<Record<TokenKey, string>>;
type PageAuthProbe = Partial<Tokens> & {
    at?: number;
    requireAvailable?: boolean;
    sources?: Partial<Record<TokenKey, string>>;
};
type AuthProbePayload = Partial<
    Pick<Tokens, 'fbDtsg' | 'lsd' | 'jazoest' | 'deviceId' | 'viewerId'>
> & {
    at: number;
    requireAvailable: boolean;
    sources: Partial<Record<TokenKey, string>>;
};
type PageRequire = (name: string) => unknown;
type PageWindow = Window & { require?: PageRequire };

export const AUTH_PROBE_EVENT = 'icr:ig-auth-probe';
export const AUTH_PROBE_REQUEST_EVENT = 'icr:ig-auth-probe-request';

let pageAuthProbe: PageAuthProbe = {};
let authProbeSequence = 0;
let tokenCache: { tokens: Tokens; at: number } | undefined;
let pendingHarvest: Promise<Tokens> | undefined;

const TOKEN_CACHE_MS = 60_000;
const AUTH_PROBE_TIMEOUT_MS = 2_500;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findString(root: unknown, keys: string[]): string | undefined {
    if (!isRecord(root)) return undefined;
    for (const key of keys) {
        const value = root[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    for (const value of Object.values(root)) {
        const found = Array.isArray(value)
            ? value.map(item => findString(item, keys)).find(Boolean)
            : findString(value, keys);
        if (found) return found;
    }
    return undefined;
}

function pageJson(): unknown[] {
    return Array.from(
        document.querySelectorAll(
            'script[type="application/json"][data-sjs], script[data-sjs]',
        ),
    )
        .map(node => node.textContent ?? '')
        .flatMap(text => {
            try {
                return [JSON.parse(text) as unknown];
            } catch {
                return [];
            }
        });
}

function pageText(): string {
    return `${document.documentElement.innerHTML}\n${Array.from(
        document.scripts,
    )
        .map(script => script.textContent ?? '')
        .join('\n')}`;
}

function firstMatch(text: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match?.[1])
            return decodeURIComponent(match[1].replaceAll('\\/', '/'));
    }
    return undefined;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.length > 0) return value;
    throw new Error(`Invalid Instagram auth probe ${field}`);
}

function parseAuthProbe(detail: string): AuthProbePayload {
    const data = JSON.parse(detail) as unknown;
    if (!isRecord(data)) throw new Error('Invalid Instagram auth probe payload');
    if (typeof data.at !== 'number')
        throw new Error('Invalid Instagram auth probe at');
    if (typeof data.requireAvailable !== 'boolean')
        throw new Error('Invalid Instagram auth probe requireAvailable');
    if (!isRecord(data.sources) || Object.keys(data.sources).length === 0)
        throw new Error('Invalid Instagram auth probe sources');

    return {
        fbDtsg: optionalString(data.fbDtsg, 'fbDtsg'),
        lsd: optionalString(data.lsd, 'lsd'),
        jazoest: optionalString(data.jazoest, 'jazoest'),
        deviceId: optionalString(data.deviceId, 'deviceId'),
        viewerId: optionalString(data.viewerId, 'viewerId'),
        at: data.at,
        requireAvailable: data.requireAvailable,
        sources: {
            fbDtsg: optionalString(data.sources.fbDtsg, 'sources.fbDtsg'),
            lsd: optionalString(data.sources.lsd, 'sources.lsd'),
            jazoest: optionalString(data.sources.jazoest, 'sources.jazoest'),
            deviceId: optionalString(data.sources.deviceId, 'sources.deviceId'),
            viewerId: optionalString(data.sources.viewerId, 'sources.viewerId'),
        },
    };
}

function readProbeToken(key: TokenKey): string | undefined {
    const value = pageAuthProbe[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function source(
    sources: TokenSources,
    key: TokenKey,
    value: string | undefined,
    from: string,
): string | undefined {
    if (value) sources[key] = from;
    return value;
}

function deriveJazoest(fbDtsg: string | undefined): string | undefined {
    if (!fbDtsg) return undefined;
    return `2${Array.from(fbDtsg).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
}

function deviceIdFallback(sources: TokenSources): string {
    const stored = localStorage.getItem('chatd-deviceid');
    if (stored) {
        sources.deviceId = 'localStorage.chatd-deviceid';
        return stored;
    }
    const generated = crypto.randomUUID();
    localStorage.setItem('chatd-deviceid', generated);
    sources.deviceId = 'generated chatd-deviceid';
    return generated;
}

function cookie(name: string): string | undefined {
    return document.cookie
        .split('; ')
        .find(part => part.startsWith(`${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');
}

function authError(values: Partial<Tokens>): Error {
    const keys: TokenKey[] = [
        'fbDtsg',
        'lsd',
        'jazoest',
        'csrfToken',
        'deviceId',
        'viewerId',
    ];
    const missing = keys.filter(key => !values[key]);
    return new Error(
        `Instagram auth tokens were not found (${missing.join(', ')}); open or refresh instagram.com/direct/inbox first.`,
    );
}

function requestAuthProbe() {
    window.dispatchEvent(new Event(AUTH_PROBE_REQUEST_EVENT));
}

export function startAuthProbeListener() {
    window.addEventListener(AUTH_PROBE_EVENT, event => {
        const detail =
            'detail' in event && typeof event.detail === 'string'
                ? event.detail
                : undefined;
        if (!detail) return;

        const data = parseAuthProbe(detail);
        pageAuthProbe = data;
        authProbeSequence += 1;
    });
}

function waitForAuthProbe(afterSequence: number, timeoutMs: number): Promise<void> {
    if (authProbeSequence > afterSequence) return Promise.resolve();
    return new Promise(resolve => {
        let timeoutId: number | undefined;
        const cleanup = () => {
            window.removeEventListener(AUTH_PROBE_EVENT, onProbe);
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            resolve();
        };
        const onProbe = () => {
            if (authProbeSequence > afterSequence) cleanup();
        };
        timeoutId = window.setTimeout(cleanup, timeoutMs);
        window.addEventListener(AUTH_PROBE_EVENT, onProbe);
    });
}

function harvestTokensNow(): Tokens {
    const roots = pageJson();
    const text = pageText();
    const sources: TokenSources = {};
    const fbDtsg =
        source(
            sources,
            'fbDtsg',
            readProbeToken('fbDtsg'),
            pageAuthProbe.sources?.fbDtsg ?? 'main-world probe',
        ) ??
        source(
            sources,
            'fbDtsg',
            roots.map(root => findString(root, ['fb_dtsg'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'fbDtsg',
            firstMatch(text, [
                /fb_dtsg=([^&"'\\]+)/,
                /"DTSGInitialData"[^]*?"token"\s*:\s*"([^"]+)"/,
                /"fb_dtsg"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        );
    const lsd =
        source(
            sources,
            'lsd',
            readProbeToken('lsd'),
            pageAuthProbe.sources?.lsd ?? 'main-world probe',
        ) ??
        source(
            sources,
            'lsd',
            roots.map(root => findString(root, ['lsd'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'lsd',
            firstMatch(text, [
                /lsd=([^&"'\\]+)/,
                /"LSD"[^]*?"token"\s*:\s*"([^"]+)"/,
                /"lsd"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        );
    const jazoest =
        source(
            sources,
            'jazoest',
            readProbeToken('jazoest'),
            pageAuthProbe.sources?.jazoest ?? 'main-world probe',
        ) ??
        source(
            sources,
            'jazoest',
            roots.map(root => findString(root, ['jazoest'])).find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'jazoest',
            firstMatch(text, [
                /jazoest=([^&"'\\]+)/,
                /"jazoest"\s*:\s*"([^"]+)"/,
            ]),
            'page text',
        ) ??
        source(
            sources,
            'jazoest',
            deriveJazoest(fbDtsg),
            'derived from fb_dtsg',
        );
    const deviceId =
        source(
            sources,
            'deviceId',
            readProbeToken('deviceId'),
            pageAuthProbe.sources?.deviceId ?? 'main-world probe',
        ) ??
        source(
            sources,
            'deviceId',
            roots
                .map(root => findString(root, ['device_id_for_iris_subscription']))
                .find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'deviceId',
            firstMatch(text, [
                /"device_id_for_iris_subscription"\s*:\s*"([^"]+)"/,
                /device_id_for_iris_subscription=([^&"'\\]+)/,
            ]),
            'page text',
        ) ??
        deviceIdFallback(sources);
    const viewerId =
        source(
            sources,
            'viewerId',
            readProbeToken('viewerId'),
            pageAuthProbe.sources?.viewerId ?? 'main-world probe',
        ) ??
        source(
            sources,
            'viewerId',
            roots
                .map(root =>
                    findString(root, [
                        'viewer_fbid',
                        'actorID',
                        'USER_ID',
                        'account_id',
                    ]),
                )
                .find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'viewerId',
            firstMatch(text, [
                /"viewer_fbid"\s*:\s*"?(\d+)/,
                /"actorID"\s*:\s*"?(\d+)/,
                /"USER_ID"\s*:\s*"?(\d+)/,
            ]),
            'page text',
        ) ??
        source(sources, 'viewerId', cookie('ds_user_id'), 'ds_user_id cookie') ??
        source(sources, 'viewerId', fbDtsg?.split(':')[1], 'fb_dtsg segment');
    const csrfToken = source(
        sources,
        'csrfToken',
        cookie('csrftoken'),
        'csrftoken cookie',
    );
    if (!fbDtsg || !lsd || !jazoest || !deviceId || !viewerId || !csrfToken)
        throw authError({ fbDtsg, lsd, jazoest, deviceId, viewerId, csrfToken });
    return { fbDtsg, lsd, jazoest, csrfToken, deviceId, viewerId };
}

async function harvestTokensFresh(): Promise<Tokens> {
    const probeSequence = authProbeSequence;
    requestAuthProbe();
    await waitForAuthProbe(probeSequence, AUTH_PROBE_TIMEOUT_MS);
    const tokens = harvestTokensNow();
    tokenCache = { tokens, at: Date.now() };
    return tokens;
}

export async function harvestTokens(force = false): Promise<Tokens> {
    const now = Date.now();
    if (!force && tokenCache && now - tokenCache.at < TOKEN_CACHE_MS)
        return tokenCache.tokens;
    pendingHarvest ??= harvestTokensFresh().finally(() => {
        pendingHarvest = undefined;
    });
    return pendingHarvest;
}

export function clearTokenCache() {
    tokenCache = undefined;
}

function requireModule(name: string): unknown {
    const pageWindow = window as PageWindow;
    try {
        return pageWindow.require?.(name);
    } catch {
        return undefined;
    }
}

function moduleToken(name: string): string | undefined {
    const mod = requireModule(name);
    return isRecord(mod) && typeof mod.token === 'string' && mod.token.length > 0
        ? mod.token
        : undefined;
}

function moduleUserId(): string | undefined {
    for (const name of ['CurrentUserInitialData', 'PolarisViewer', 'Viewer']) {
        const value = requireModule(name);
        if (!isRecord(value)) continue;
        for (const key of ['USER_ID', 'ACCOUNT_ID', 'actorID', 'viewer_fbid']) {
            const found = value[key];
            if (typeof found === 'string' && found.length > 0) return found;
        }
    }
    return undefined;
}

function deviceId(): string {
    const stored = localStorage.getItem('chatd-deviceid');
    if (stored) return stored;
    const generated = crypto.randomUUID();
    localStorage.setItem('chatd-deviceid', generated);
    return generated;
}

function emitProbe() {
    const pageWindow = window as PageWindow;
    const fbDtsg = moduleToken('DTSGInitialData');
    const lsd = moduleToken('LSD') ?? moduleToken('LSDToken');
    const jazoest = deriveJazoest(fbDtsg);
    const viewerId = moduleUserId() ?? fbDtsg?.split(':')[1];
    const probe: AuthProbePayload = {
        fbDtsg,
        lsd,
        jazoest,
        deviceId: deviceId(),
        viewerId,
        at: Date.now(),
        requireAvailable: typeof pageWindow.require === 'function',
        sources: {
            fbDtsg: fbDtsg ? "require('DTSGInitialData').token" : undefined,
            lsd: lsd ? "require('LSD'|'LSDToken').token" : undefined,
            jazoest: jazoest ? 'derived from fb_dtsg' : undefined,
            deviceId: 'localStorage.chatd-deviceid',
            viewerId: viewerId
                ? 'CurrentUserInitialData or fb_dtsg segment'
                : undefined,
        },
    };
    window.dispatchEvent(
        new CustomEvent(AUTH_PROBE_EVENT, { detail: JSON.stringify(probe) }),
    );
}

export function startMainWorldAuthProbe() {
    window.addEventListener(AUTH_PROBE_REQUEST_EVENT, emitProbe);
    emitProbe();
    window.setTimeout(emitProbe, 500);
    window.setTimeout(emitProbe, 2_000);
}
