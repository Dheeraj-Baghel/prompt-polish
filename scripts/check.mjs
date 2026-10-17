import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.optional_host_permissions, ['https://api.anthropic.com/*']);
assert.equal(manifest.host_permissions, undefined);
assert.equal(manifest.content_scripts, undefined);
for (const path of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_page, ...Object.values(manifest.icons)]) assert.ok(existsSync('extension/' + path), `Missing ${path}`);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`]);
const files = [...walk('extension'), ...walk('tests'), ...walk('scripts')];
for (const file of files.filter((path) => /\.(m?js)$/.test(path))) execFileSync(process.execPath, ['--check', file]);
for (const file of files.filter((path) => /\.(html|js|css)$/.test(path) && path.startsWith('extension/'))) {
  const source = readFileSync(file, 'utf8');
  assert.ok(!/\beval\s*\(|new Function\s*\(/.test(source), `Unsafe dynamic execution in ${file}`);
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(source), `Untrusted HTML sink in ${file}`);
  assert.ok(!/<script[^>]+src=["']https?:/.test(source), `Remote script in ${file}`);
  assert.ok(!/storage\.sync/.test(source), `Synced private data in ${file}`);
}
console.log(`Manifest, assets, syntax, and security checks passed (${files.length} files).`);