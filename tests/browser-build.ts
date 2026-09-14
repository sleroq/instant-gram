import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';

export async function buildExtension(root: string, copyTo?: string) {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    if (copyTo) {
        await rm(copyTo, { recursive: true, force: true });
        await cp(`${root}/.output/chrome-mv3`, copyTo, { recursive: true });
    }
}
