// Finishes `expo export --platform web` for static hosting (e.g. GitHub Pages):
// - prefixes the PWA links in index.html with WEB_BASE_URL
// - copies index.html to 404.html so deep links open the app
// - adds .nojekyll so GitHub Pages serves the `_expo` folder
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const base = (process.env.WEB_BASE_URL ?? '').replace(/\/$/, '');
const file = 'dist/index.html';
let html = readFileSync(file, 'utf8');
html = html
  .replace('href="/apple-touch-icon.png"', `href="${base}/apple-touch-icon.png"`)
  .replace('href="/manifest.json"', `href="${base}/manifest.json"`);
writeFileSync(file, html);
copyFileSync(file, 'dist/404.html');
writeFileSync('dist/.nojekyll', '');
console.log(`Web build ready in dist/ (base URL: "${base || '/'}")`);
