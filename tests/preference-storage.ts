import type { Page } from 'playwright';

declare global {
    interface Window {
        preferenceTest: {
            storage: unknown;
            values: Record<string, unknown>;
            fail: boolean;
            firstMountMotion?: string;
            publish(value: unknown, area?: string): void;
        };
    }
}

// Callback APIs exercise the production webextension-polyfill adapter.
export async function installPreferenceStorage(page: Page, initial?: unknown) {
    await page.addInitScript((initial) => {
        const listeners = new Set<
            (
                changes: Record<string, { newValue?: unknown }>,
                area: string,
            ) => void
        >();
        const key = 'presentation.motion';
        const values: Record<string, unknown> = { [key]: initial };
        window.preferenceTest = {
            values,
            fail: false,
            publish(value, area = 'local') {
                if (area === 'local') values[key] = value;
                listeners.forEach((listener) =>
                    listener({ [key]: { newValue: value } }, area),
                );
            },
            storage: {
                local: {
                    get(
                        key: string,
                        callback: (values: Record<string, unknown>) => void,
                    ) {
                        callback({ [key]: values[key] });
                    },
                    set(update: Record<string, unknown>, callback: () => void) {
                        if (window.preferenceTest.fail)
                            throw new Error('Fixture storage failure');
                        Object.assign(values, update);
                        window.preferenceTest.publish(values[key]);
                        callback();
                    },
                },
                onChanged: {
                    addListener: (
                        listener: (
                            changes: Record<string, { newValue?: unknown }>,
                            area: string,
                        ) => void,
                    ) => listeners.add(listener),
                    removeListener: (
                        listener: (
                            changes: Record<string, { newValue?: unknown }>,
                            area: string,
                        ) => void,
                    ) => listeners.delete(listener),
                },
            },
        };
        const observer = new MutationObserver(() => {
            if (!document.querySelector('.solid-app')) return;
            window.preferenceTest.firstMountMotion =
                document.documentElement.dataset.motion;
            observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
    }, initial);
}
