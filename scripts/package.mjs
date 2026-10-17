import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
execFileSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' });
const { version } = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
mkdirSync('artifacts', { recursive: true });
const target = path.resolve(`artifacts/prompt-polish-${version}.zip`);
rmSync(target, { force: true });
// Ship only extension files, never dev dependencies, browser profiles, or secrets.
execFileSync('zip', ['-r', target, '.', '-x', '*.DS_Store'], { cwd: 'extension', stdio: 'inherit' });
console.log(`Created ${target}`);