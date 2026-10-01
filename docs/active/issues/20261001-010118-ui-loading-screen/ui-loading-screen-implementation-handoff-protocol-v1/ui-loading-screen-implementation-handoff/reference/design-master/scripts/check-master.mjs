import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tokensCss = path.join(root, 'css', 'tokens.css');
const componentCss = path.join(root, 'css', 'component.css');
const htmlPath = path.join(root, 'index.html');
const emblemWebpPath = path.join(root, 'assets', 'emblem.webp');

// Verification must be read-only. A stale generated file is an error, not something
// `npm run check` should silently rewrite in the developer's working tree.
execFileSync(process.execPath, [path.join(here, 'build-tokens.mjs'), '--check'], { stdio: 'inherit' });

const component = fs.readFileSync(componentCss, 'utf8');
const generated = fs.readFileSync(tokensCss, 'utf8');
const css = `${generated}\n${component}`;

const definitions = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const references = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\b/g)].map(m => m[1]);
const missing = [...new Set(references.filter(name => !definitions.has(name)))];
if (missing.length) throw new Error(`Undefined CSS variables: ${missing.join(', ')}`);

const allowedClass = name =>
  name === 'loading-screen' ||
  name.startsWith('loading-screen__') ||
  name === 'loading-background' ||
  name.startsWith('loading-background__');

const cssClasses = [...component.matchAll(/\.([a-z][a-z0-9_-]*)/gi)].map(m => m[1]);
const invalidCssClasses = [...new Set(cssClasses.filter(name => !allowedClass(name)))];
if (invalidCssClasses.length) {
  throw new Error(`Class selectors outside the component namespace: ${invalidCssClasses.join(', ')}`);
}

const html = fs.readFileSync(htmlPath, 'utf8');
if (!/<html\b[^>]*\blang=["']ja["']/i.test(html)) {
  throw new Error('index.html must declare lang="ja".');
}
if (!html.includes('role="status"') || !html.includes('読み込み中')) {
  throw new Error('Accessible loading status is missing.');
}
if (!html.includes('class="loading-screen__visually-hidden"')) {
  throw new Error('The accessible loading text must use the component-scoped visually-hidden class.');
}
if (!component.includes('prefers-reduced-motion')) {
  throw new Error('Reduced-motion support is missing.');
}
if (!fs.existsSync(emblemWebpPath)) throw new Error('assets/emblem.webp is missing.');
if (/\sstyle\s*=/.test(html)) {
  throw new Error('Inline style found in index.html; move values into the master CSS/tokens.');
}

const htmlClasses = [...html.matchAll(/\bclass=["']([^"']+)["']/g)]
  .flatMap(([, value]) => value.trim().split(/\s+/));
const invalidHtmlClasses = [...new Set(htmlClasses.filter(name => !allowedClass(name)))];
if (invalidHtmlClasses.length) {
  throw new Error(`Classes outside the component namespace: ${invalidHtmlClasses.join(', ')}`);
}

const emblemTag = html.match(/<img\b[^>]*\bclass=["'][^"']*\bloading-screen__emblem\b[^"']*["'][^>]*>/i)?.[0];
if (!emblemTag) throw new Error('Loading emblem image is missing.');
const attr = name => emblemTag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1];
if (attr('src') !== 'assets/emblem.webp') throw new Error('Loading emblem must use assets/emblem.webp.');
if (attr('width') !== '46' || attr('height') !== '46') throw new Error('Loading emblem HTML dimensions must remain 46x46.');
if (attr('alt') !== '' || attr('aria-hidden') !== 'true') {
  throw new Error('Loading emblem must remain decorative (empty alt and aria-hidden="true").');
}

const backgroundTag = html.match(/<div\b[^>]*\bclass=["'][^"']*\bloading-background\b[^"']*["'][^>]*>/i)?.[0];
if (!backgroundTag || !/\baria-hidden=["']true["']/i.test(backgroundTag)) {
  throw new Error('Decorative loading background must be aria-hidden="true".');
}

console.log('Design master checks passed.');
