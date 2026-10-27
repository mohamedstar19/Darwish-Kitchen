// Finishes `expo export --platform web` for static hosting:
// - prefixes the PWA links in index.html with WEB_BASE_URL
// - adds ?v=<content hash> to the icon/manifest links (and the icons inside the manifest),
//   so a new icon gets a new URL that no browser or Cloudflare cache has seen
// - copies index.html to 404.html so deep links open the app
// - adds .nojekyll so GitHub Pages serves the `_expo` folder
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const base = (process.env.WEB_BASE_URL ?? '').replace(/\/$/, '');
const version = (path) => createHash('sha256').update(readFileSync(`dist/${path}`)).digest('hex').slice(0, 10);

// Manifest: version each icon, then version the manifest itself (its content now includes the icon versions).
const manifestPath = 'dist/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `${icon.src.split('?')[0]}?v=${version(icon.src.split('?')[0])}` }));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const file = 'dist/index.html';
let html = readFileSync(file, 'utf8');
html = html
  .replace('href="/apple-touch-icon.png"', `href="${base}/apple-touch-icon.png?v=${version('apple-touch-icon.png')}"`)
  .replace('href="/manifest.json"', `href="${base}/manifest.json?v=${version('manifest.json')}"`);
if (existsSync('dist/favicon.ico')) {
  html = html.replace(/href="([^"]*\/favicon\.ico)"/, `href="$1?v=${version('favicon.ico')}"`);
}
writeFileSync(file, html);
copyFileSync(file, 'dist/404.html');
writeFileSync('dist/.nojekyll', '');
console.log(`Web build ready in dist/ (base URL: "${base || '/'}")`);
