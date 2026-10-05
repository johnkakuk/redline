// Renders the app icon SVG to the PNG sizes iOS and the manifest need.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const font = fs.readFileSync(new URL('../public/fonts/BarlowCondensed-Bold.woff2', import.meta.url)).toString('base64');
// Wordmark-derived mark: a bold "R" with the red line through the bottom third.
const svg = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <style>@font-face{font-family:B;src:url(data:font/woff2;base64,${font})}</style>
  <rect width="512" height="512" fill="#0A0A0B"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <text x="256" y="372" text-anchor="middle" font-family="B" font-weight="700" font-size="380" fill="#F5F5F7" letter-spacing="-8">R</text>
    <rect x="76" y="318" width="360" height="34" rx="6" fill="#E5162A"/>
  </g>
</svg>`;

const out = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.22],
  ['apple-touch-icon.png', 180, 0.04],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#0A0A0B">${svg(size, pad)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, clip: { x: 0, y: 0, width: size, height: size } });
}
fs.writeFileSync(new URL('../public/favicon.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0A0A0B"/><path d="M150 96h130c74 0 120 40 120 104 0 46-24 78-64 94l74 122h-86l-64-112h-36v112h-74z M224 160v76h52c28 0 46-14 46-38s-18-38-46-38z" fill="#F5F5F7"/><rect x="76" y="318" width="360" height="34" rx="6" fill="#E5162A"/></svg>`);
await browser.close();
console.log('icons written');
