import { defineContentScript } from "wxt/utils/define-content-script";

type PageRequire = (name: string) => unknown;
type PageWindow = Window & { require?: PageRequire };
type Probe = {
    fbDtsg?: string;
    lsd?: string;
    jazoest?: string;
    deviceId?: string;
    viewerId?: string;
    at: number;
    requireAvailable: boolean;
    sources: Partial<Record<"fbDtsg" | "lsd" | "jazoest" | "deviceId" | "viewerId", string>>;
};

const AUTH_PROBE_EVENT = "icr:ig-auth-probe";
const AUTH_PROBE_REQUEST_EVENT = "icr:ig-auth-probe-request";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
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
    return isRecord(mod) ? str(mod.token) : undefined;
}

function moduleUserId(): string | undefined {
    for (const name of ["CurrentUserInitialData", "PolarisViewer", "Viewer"]) {
        const value = requireModule(name);
        if (!isRecord(value)) continue;
        for (const key of ["USER_ID", "ACCOUNT_ID", "actorID", "viewer_fbid"]) {
            const found = str(value[key]);
            if (found) return found;
        }
    }
    return undefined;
}

function deriveJazoest(fbDtsg: string | undefined): string | undefined {
    if (!fbDtsg) return undefined;
    return `2${Array.from(fbDtsg).reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
}

function deviceId(): string {
    const stored = localStorage.getItem("chatd-deviceid");
    if (stored) return stored;
    const generated = crypto.randomUUID();
    localStorage.setItem("chatd-deviceid", generated);
    return generated;
}

function emitProbe() {
    const pageWindow = window as PageWindow;
    const fbDtsg = moduleToken("DTSGInitialData");
    const lsd = moduleToken("LSD") ?? moduleToken("LSDToken");
    const jazoest = deriveJazoest(fbDtsg);
    const viewerId = moduleUserId() ?? fbDtsg?.split(":")[1];
    const probe: Probe = {
        fbDtsg,
        lsd,
        jazoest,
        deviceId: deviceId(),
        viewerId,
        at: Date.now(),
        requireAvailable: typeof pageWindow.require === "function",
        sources: {
            fbDtsg: fbDtsg ? "require('DTSGInitialData').token" : undefined,
            lsd: lsd ? "require('LSD'|'LSDToken').token" : undefined,
            jazoest: jazoest ? "derived from fb_dtsg" : undefined,
            deviceId: "localStorage.chatd-deviceid",
            viewerId: viewerId ? "CurrentUserInitialData or fb_dtsg segment" : undefined,
        },
    };
    window.dispatchEvent(new CustomEvent(AUTH_PROBE_EVENT, { detail: JSON.stringify(probe) }));
}

export default defineContentScript({
    matches: ["https://www.instagram.com/*"],
    runAt: "document_idle",
    world: "MAIN",
    main() {
        window.addEventListener(AUTH_PROBE_REQUEST_EVENT, emitProbe);
        emitProbe();
        window.setTimeout(emitProbe, 500);
        window.setTimeout(emitProbe, 2_000);
    },
});
