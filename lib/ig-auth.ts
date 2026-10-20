import {
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

type AuthProbePayload = Partial<
    Pick<Tokens, 'fbDtsg' | 'lsd' | 'deviceId' | 'viewerId'>
> & { at: number };
type TokenModule = { token?: string };
type IdentityModule = {
    viewer_fbid?: string;
    actorID?: string;
};
type PageModules = {
    DTSGInitialData: TokenModule;
    LSD: TokenModule;
    LSDToken: TokenModule;
    CurrentUserInitialData: IdentityModule;
    PolarisViewer: IdentityModule & {
        data?: { fbid?: string; id?: string };
    };
    Viewer: IdentityModule;
};
type PageRequire = <Name extends keyof PageModules>(
    name: Name,
) => PageModules[Name] | undefined;

declare global {
    interface Window {
        require?: PageRequire;
    }
    interface WindowEventMap {
        [AUTH_PROBE_EVENT]: CustomEvent<string>;
    }
}

export const AUTH_PROBE_EVENT = 'icr:ig-auth-probe-v3';
export const AUTH_PROBE_REQUEST_EVENT = 'icr:ig-auth-probe-request-v3';

let tokenCache: { tokens: Tokens; at: number } | undefined;
let pendingHarvest: Promise<Tokens> | undefined;

const TOKEN_CACHE_MS = 60_000;
const AUTH_PROBE_TIMEOUT_MS = 2_500;
const AUTH_PROBE_TTL_MS = 60_000;

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
    return {
        fbDtsg: optionalString(data.fbDtsg, 'fbDtsg'),
        lsd: optionalString(data.lsd, 'lsd'),
        deviceId: optionalString(data.deviceId, 'deviceId'),
        viewerId: userId(data.viewerId),
        at: data.at,
    };
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

function requestAuthProbe(): Promise<AuthProbePayload> {
    return new Promise((resolve, reject) => {
        function cleanup() {
            window.removeEventListener(AUTH_PROBE_EVENT, receive);
            window.clearTimeout(timeout);
        }
        function receive(event: WindowEventMap[typeof AUTH_PROBE_EVENT]) {
            let probe: AuthProbePayload;
            try {
                probe = parseAuthProbe(event.detail);
                const age = Date.now() - probe.at;
                if (age < 0 || age > AUTH_PROBE_TTL_MS) return;
            } catch {
                // Ignore malformed data crossing the page/content-script boundary.
                return;
            }
            cleanup();
            resolve(probe);
        }
        const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('Instagram authentication probe is unavailable.'));
        }, AUTH_PROBE_TIMEOUT_MS);
        window.addEventListener(AUTH_PROBE_EVENT, receive);
        window.dispatchEvent(new Event(AUTH_PROBE_REQUEST_EVENT));
    });
}

async function harvestTokensFresh(): Promise<Tokens> {
    const { fbDtsg, lsd, deviceId, viewerId } = await requestAuthProbe();
    const csrfToken = cookie('csrftoken');
    if (!fbDtsg || !lsd || !deviceId || !viewerId || !csrfToken)
        throw new Error(
            'Instagram auth tokens were not found; open or refresh instagram.com/direct/inbox first.',
        );
    const jazoest = `2${Array.from(fbDtsg).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
    const tokens = { fbDtsg, lsd, jazoest, csrfToken, deviceId, viewerId };
    tokenCache = { tokens, at: Date.now() };
    return tokens;
}

export async function harvestTokens(force = false): Promise<Tokens> {
    if (!force && tokenCache && Date.now() - tokenCache.at < TOKEN_CACHE_MS)
        return tokenCache.tokens;
    pendingHarvest ??= harvestTokensFresh().finally(() => {
        pendingHarvest = undefined;
    });
    return pendingHarvest;
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
    const actor = userId(requireModule('PolarisViewer')?.data?.fbid);
    if (actor) return actor;
    for (const name of [
        'CurrentUserInitialData',
        'PolarisViewer',
        'Viewer',
    ] as const) {
        const value = requireModule(name);
        for (const found of [value?.viewer_fbid, value?.actorID]) {
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
    const probe: AuthProbePayload = {
        fbDtsg,
        lsd: moduleToken('LSD') ?? moduleToken('LSDToken'),
        deviceId: deviceId(),
        viewerId: moduleUserId(),
        at: Date.now(),
    };
    window.dispatchEvent(
        new CustomEvent(AUTH_PROBE_EVENT, { detail: JSON.stringify(probe) }),
    );
}

export function startMainWorldAuthProbe() {
    // SAFETY: This cleanup slot is owned exclusively by the MAIN-world probe.
    const host = window as Window & {
        __instantGramAuthProbeCleanup?: () => void;
    };
    host.__instantGramAuthProbeCleanup?.();
    window.addEventListener(AUTH_PROBE_REQUEST_EVENT, emitProbe);
    host.__instantGramAuthProbeCleanup = () =>
        window.removeEventListener(AUTH_PROBE_REQUEST_EVENT, emitProbe);
}
