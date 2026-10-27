// Finishes `expo export --platform web` for static hosting:
// - prefixes the PWA links in index.html with WEB_BASE_URL
// - adds ?v=<content hash> to the icon/manifest links (and the icons inside the manifest),
//   so a new icon gets a new URL that no browser or Cloudflare cache has seen
// - copies index.html to 404.html so deep links open the app
// - adds .nojekyll so GitHub Pages serves the `_expo` folder
// - builds the product page (site/page.html + site/img) into dist/about/
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

// Product page: site/page.html holds the head part (title, styles) before "<!-- /head -->" and the content after it.
const SITE_URL = 'https://kitchen.darwish-tech.com';
const [pageHead, pageBody] = readFileSync('site/page.html', 'utf8').split('<!-- /head -->');
const description = /<meta name="description" content="([^"]*)"/.exec(pageHead)?.[1] ?? '';
mkdirSync('dist/about', { recursive: true });
cpSync('site/img', 'dist/about/img', { recursive: true });
writeFileSync(
  'dist/about/index.html',
  `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#C2410C">
<meta property="og:type" content="website">
<meta property="og:title" content="Darwish Kitchen | حناكل إيه النهارده؟">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${SITE_URL}/about/">
<meta property="og:image" content="${SITE_URL}/about/img/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${base}/favicon.ico">
<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">
<style>body{margin:0}img{max-width:100%}</style>
${pageHead.trim()}
</head>
<body>
${pageBody.trim()}
</body>
</html>
`,
);
writeFileSync('dist/.nojekyll', '');
console.log(`Web build ready in dist/ (base URL: "${base || '/'}")`);
