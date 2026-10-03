import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'public', 'licenses', 'dependencies');
await mkdir(destination, { recursive: true });
const notices = [];
async function collect(folder, name, version, license) {
  const prefix = `${name.replace(/[^a-zA-Z0-9.-]/g, '_')}-${version}`;
  const files = await readdir(folder, { withFileTypes: true });
  const included = [];
  for (const file of files) {
    if (!file.isFile() || !/^(licen[cs]e|copying|copyright|notice|ofl)([._-]|$)/i.test(file.name)) continue;
    const filename = `${prefix}-${file.name}.txt`;
    await copyFile(join(folder, file.name), join(destination, filename));
    included.push(filename);
  }
  notices.push({ name, version, license: license || 'See upstream source', files: included });
}
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const folder = join(root, path);
  const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  await collect(folder, manifest.name, manifest.version, manifest.license);
}
// Cargo metadata supplies attribution for native dependencies available on this build platform.
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString());
for (const pkg of metadata.packages) {
  if (pkg.name === 'customsuno') continue;
  await collect(dirname(pkg.manifest_path), pkg.name, pkg.version, pkg.license);
}
notices.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(join(destination, 'ATTRIBUTION.json'), `${JSON.stringify(notices, null, 2)}\n`);
console.log(`Collected license notices for ${notices.length} dependencies.`);
