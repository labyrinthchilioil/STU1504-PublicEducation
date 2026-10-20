import { readdir, readFile, lstat, mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = path.resolve(project, 'web');
const output = path.resolve(project, '_site');
const siteBase = new URL('https://labyrinthchilioil.github.io/STU1504-PublicEducation/');
const allowedExtensions = new Set(['.html', '.css', '.js', '.json', '.txt', '.ttf', '.woff', '.woff2', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico']);

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
      throw new Error(`Review unexpected hidden file or symbolic link in web/: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relative + '/'));
    } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name))) {
      files.push(relative);
    } else {
      throw new Error(`Unexpected publication file: web/${relative}`);
    }
  }
  return files.sort();
}

const files = await listFiles(source);
const inventory = new Set(files);
for (const required of ['index.html', 'app.js', 'data/frame12.json', 'data/integrity.json']) {
  if (!inventory.has(required)) throw new Error(`Missing required file: ${required}`);
}

// Validate local links at the project URL without rewriting any application file.
let references = 0;
for (const file of files) {
  const extension = path.extname(file);
  if (!['.html', '.css', '.js', '.json'].includes(extension)) continue;
  const text = await readFile(path.join(source, file), 'utf8');
  if (extension === '.json') JSON.parse(text);
  if (extension === '.js') {
    const check = spawnSync(process.execPath, ['--check', path.join(source, file)], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(check.stderr || `JavaScript syntax check failed: ${file}`);
  }
  const pattern = extension === '.html' ? /\b(?:src|href)\s*=\s*["']([^"']+)["']/g
    : extension === '.css' ? /url\(\s*["']?([^"')\s]+)["']?\s*\)/g
    : extension === '.js' ? /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bfetch\(\s*)["']([^"']+)["']/g
    : null;
  if (!pattern) continue;
  for (const [, reference] of text.matchAll(pattern)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) continue;
    const resolved = new URL(reference, new URL(file, siteBase));
    if (!resolved.pathname.startsWith(siteBase.pathname)) {
      throw new Error(`Link escapes the repository base path in ${file}: ${reference}`);
    }
    let target = decodeURIComponent(resolved.pathname.slice(siteBase.pathname.length));
    if (!target || target.endsWith('/')) target += 'index.html';
    if (!inventory.has(target)) throw new Error(`Missing local asset in ${file}: ${reference}`);
    references++;
  }
}

// Only replace this generated directory; never traverse a linked output folder.
if (path.dirname(output) !== path.resolve(project) || path.basename(output) !== '_site') {
  throw new Error('Unexpected build output path.');
}
const previousOutput = await lstat(output).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (previousOutput?.isSymbolicLink()) throw new Error('Build output must not be a symbolic link.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(source, file), destination);
}
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Built _site/: ${files.length} unchanged website files + .nojekyll.`);
console.log(`Verified ${references} local references at ${siteBase.pathname}`);
