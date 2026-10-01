import {
    isBoolean,
    isJsonObject,
    isNumber,
    isString,
    parseJson,
    type JsonValue,
} from './json.ts';

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
type TokenModule = { token?: string };
type IdentityModule = {
    viewer_fbid?: string;
    actorID?: string;
    USER_ID?: string;
    ACCOUNT_ID?: string;
};
type PageModules = {
    DTSGInitialData: TokenModule;
    LSD: TokenModule;
    LSDToken: TokenModule;
    CurrentUserInitialData: IdentityModule;
    PolarisViewer: IdentityModule;
    Viewer: IdentityModule;
};
type PageRequire = <Name extends keyof PageModules>(
    name: Name,
) => PageModules[Name] | undefined;

function hasPageRequire(value: Window['require']): value is PageRequire {
    return typeof value === 'function';
}

declare global {
    interface Window {
        require?: PageRequire;
    }
    interface WindowEventMap {
        'icr:ig-auth-probe': CustomEvent<string>;
    }
}

export const AUTH_PROBE_EVENT = 'icr:ig-auth-probe';
export const AUTH_PROBE_REQUEST_EVENT = 'icr:ig-auth-probe-request';

let pageAuthProbe: PageAuthProbe = {};
let authProbeSequence = 0;
let tokenCache: { tokens: Tokens; at: number } | undefined;
let pendingHarvest: Promise<Tokens> | undefined;

const TOKEN_CACHE_MS = 60_000;
const AUTH_PROBE_TIMEOUT_MS = 2_500;
const AUTH_PROBE_TTL_MS = 60_000;

function findString(root: JsonValue, keys: string[]): string | undefined {
    if (!isJsonObject(root)) return undefined;
    for (const key of keys) {
        const value = root[key];
        if (isString(value) && value.length > 0) return value;
    }
    for (const value of Object.values(root)) {
        if (value === undefined) continue;
        const found = Array.isArray(value)
            ? value.map((item) => findString(item, keys)).find(Boolean)
            : findString(value, keys);
        if (found) return found;
    }
    return undefined;
}

function pageJson(): JsonValue[] {
    return Array.from(
        document.querySelectorAll(
            'script[type="application/json"][data-sjs], script[data-sjs]',
        ),
    )
        .map((node) => node.textContent ?? '')
        .flatMap((text) => {
            try {
                return [parseJson(text)];
            } catch {
                return [];
            }
        });
}

function pageText(): string {
    return `${document.documentElement.innerHTML}\n${Array.from(
        document.scripts,
    )
        .map((script) => script.textContent ?? '')
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

function optionalString(
    value: JsonValue | undefined,
    field: string,
): string | undefined {
    if (value === undefined) return undefined;
    if (isString(value) && value.length > 0) return value;
    throw new Error(`Invalid Instagram auth probe ${field}`);
}

function userId(value: JsonValue | undefined): string | undefined {
    return isString(value) && /^\d+$/.test(value) && value !== '0'
        ? value
        : undefined;
}

function parseAuthProbe(detail: string): AuthProbePayload {
    const data = parseJson(detail);
    if (!isJsonObject(data))
        throw new Error('Invalid Instagram auth probe payload');
    if (!isNumber(data.at)) throw new Error('Invalid Instagram auth probe at');
    if (!isBoolean(data.requireAvailable))
        throw new Error('Invalid Instagram auth probe requireAvailable');
    if (!isJsonObject(data.sources) || Object.keys(data.sources).length === 0)
        throw new Error('Invalid Instagram auth probe sources');

    return {
        fbDtsg: optionalString(data.fbDtsg, 'fbDtsg'),
        lsd: optionalString(data.lsd, 'lsd'),
        jazoest: optionalString(data.jazoest, 'jazoest'),
        deviceId: optionalString(data.deviceId, 'deviceId'),
        viewerId: userId(data.viewerId),
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
    if (key === 'viewerId') return userId(value);
    return isString(value) && value.length > 0 ? value : undefined;
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
        .find((part) => part.startsWith(`${name}=`))
        ?.split('=')
        .slice(1)
        .join('=');
}

export function currentInstagramAccountId(): string {
    const accountId = userId(cookie('ds_user_id'));
    if (!accountId) throw new Error('Instagram authentication is unavailable.');
    return accountId;
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
    const missing = keys.filter((key) => !values[key]);
    return new Error(
        `Instagram auth tokens were not found (${missing.join(', ')}); open or refresh instagram.com/direct/inbox first.`,
    );
}

function requestAuthProbe() {
    window.dispatchEvent(new Event(AUTH_PROBE_REQUEST_EVENT));
}

export function startAuthProbeListener() {
    const receive = (event: WindowEventMap[typeof AUTH_PROBE_EVENT]) => {
        const detail = event.detail;
        if (!detail) return;

        try {
            const data = parseAuthProbe(detail);
            const age = Date.now() - data.at;
            if (age < 0 || age > AUTH_PROBE_TTL_MS) return;
            pageAuthProbe = data;
            authProbeSequence += 1;
        } catch {
            // Ignore malformed data crossing the page/content-script boundary.
        }
    };
    window.addEventListener(AUTH_PROBE_EVENT, receive);
    return () => window.removeEventListener(AUTH_PROBE_EVENT, receive);
}

function waitForAuthProbe(
    afterSequence: number,
    timeoutMs: number,
): Promise<void> {
    if (authProbeSequence > afterSequence) return Promise.resolve();
    return new Promise((resolve) => {
        let timeoutId: number | undefined;
        function cleanup() {
            window.removeEventListener(AUTH_PROBE_EVENT, onProbe);
            if (timeoutId !== undefined) window.clearTimeout(timeoutId);
            resolve();
        }
        function onProbe() {
            if (authProbeSequence > afterSequence) cleanup();
        }
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
            roots.map((root) => findString(root, ['fb_dtsg'])).find(Boolean),
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
            roots.map((root) => findString(root, ['lsd'])).find(Boolean),
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
            roots.map((root) => findString(root, ['jazoest'])).find(Boolean),
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
                .map((root) =>
                    findString(root, ['device_id_for_iris_subscription']),
                )
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
                .map((root) =>
                    userId(
                        findString(root, [
                            'viewer_fbid',
                            'actorID',
                            'USER_ID',
                            'account_id',
                        ]),
                    ),
                )
                .find(Boolean),
            'script[data-sjs] JSON',
        ) ??
        source(
            sources,
            'viewerId',
            userId(
                firstMatch(text, [
                    /"viewer_fbid"\s*:\s*"?(\d+)/,
                    /"actorID"\s*:\s*"?(\d+)/,
                    /"USER_ID"\s*:\s*"?(\d+)/,
                ]),
            ),
            'page text',
        ) ??
        source(
            sources,
            'viewerId',
            userId(cookie('ds_user_id')),
            'ds_user_id cookie',
        ) ??
        source(
            sources,
            'viewerId',
            userId(fbDtsg?.split(':')[1]),
            'fb_dtsg segment',
        );
    const csrfToken = source(
        sources,
        'csrfToken',
        cookie('csrftoken'),
        'csrftoken cookie',
    );
    if (!fbDtsg || !lsd || !jazoest || !deviceId || !viewerId || !csrfToken)
        throw authError({
            fbDtsg,
            lsd,
            jazoest,
            deviceId,
            viewerId,
            csrfToken,
        });
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

function requireModule<Name extends keyof PageModules>(
    name: Name,
): PageModules[Name] | undefined {
    try {
        return window.require?.(name);
    } catch {
        return undefined;
    }
}

function moduleToken(
    name: 'DTSGInitialData' | 'LSD' | 'LSDToken',
): string | undefined {
    const mod = requireModule(name);
    return isString(mod?.token) && mod.token.length > 0 ? mod.token : undefined;
}

function moduleUserId(): string | undefined {
    for (const name of [
        'CurrentUserInitialData',
        'PolarisViewer',
        'Viewer',
    ] as const) {
        const value = requireModule(name);
        for (const found of [
            value?.viewer_fbid,
            value?.actorID,
            value?.USER_ID,
            value?.ACCOUNT_ID,
        ]) {
            const id = userId(found);
            if (id) return id;
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
    const fbDtsg = moduleToken('DTSGInitialData');
    const lsd = moduleToken('LSD') ?? moduleToken('LSDToken');
    const jazoest = deriveJazoest(fbDtsg);
    const viewerId = moduleUserId() ?? userId(fbDtsg?.split(':')[1]);
    const probe: AuthProbePayload = {
        fbDtsg,
        lsd,
        jazoest,
        deviceId: deviceId(),
        viewerId,
        at: Date.now(),
        requireAvailable: hasPageRequire(window.require),
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
    // SAFETY: This optional marker is owned exclusively by the MAIN-world probe.
    const host = window as Window & { __instantGramAuthProbeStarted?: boolean };
    if (host.__instantGramAuthProbeStarted) return;
    host.__instantGramAuthProbeStarted = true;
    window.addEventListener(AUTH_PROBE_REQUEST_EVENT, emitProbe);
    emitProbe();
    window.setTimeout(emitProbe, 500);
    window.setTimeout(emitProbe, 2_000);
}
