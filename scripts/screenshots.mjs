#!/usr/bin/env node

/**
 * Renders media/sample.md to PNG screenshots using the actual preview stylesheet.
 * Produces media/screenshot-light.png and media/screenshot-dark.png.
 *
 * Usage: node scripts/screenshots.mjs
 * Requires: npm install (puppeteer + marked as devDependencies)
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { marked } from 'marked';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const markdown = await readFile(join(root, 'media', 'sample.md'), 'utf8');
const css = await readFile(join(root, 'styles', 'preview.css'), 'utf8');
const html = await marked.parse(markdown);

const WIDTH = 880;
const PADDING_BOTTOM = 48; // matches preview.css body padding

async function capture(darkMode, outputName) {
    const bg = darkMode ? '#1e1e1e' : '#ffffff';
    const colourScheme = darkMode ? 'dark' : 'light';

    const page_html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
:root { color-scheme: ${colourScheme}; }
html { background: ${bg}; }
${css}
</style>
</head>
<body>${html}</body>
</html>`;

    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: colourScheme },
    ]);
    await page.setViewport({ width: WIDTH, height: 800, deviceScaleFactor: 2 });
    await page.setContent(page_html, { waitUntil: 'networkidle0' });

    // Size to content
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: WIDTH, height: bodyHeight + PADDING_BOTTOM, deviceScaleFactor: 2 });

    const outputPath = join(root, 'media', outputName);
    await page.screenshot({ path: outputPath, fullPage: true });
    await browser.close();

    console.log(`  ${outputName} (${WIDTH}x${bodyHeight + PADDING_BOTTOM} @2x)`);
}

console.log('Rendering screenshots...');
await capture(false, 'screenshot-light.png');
await capture(true, 'screenshot-dark.png');
console.log('Done.');
