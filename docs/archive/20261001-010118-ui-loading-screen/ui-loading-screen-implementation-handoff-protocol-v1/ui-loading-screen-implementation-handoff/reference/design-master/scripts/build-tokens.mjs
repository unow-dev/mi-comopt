import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'tokens', 'design-tokens.json');
const outputPath = path.join(root, 'css', 'tokens.css');
const checkOnly = process.argv.includes('--check');
const tokens = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const supportedTypes = new Set([
  'color',
  'fontFamily',
  'dimension',
  'number',
  'shadow',
  'duration',
  'cubicBezier',
]);

function isToken(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$value');
}

function getByPath(pathText) {
  return pathText.split('.').reduce((node, key) => node?.[key], tokens);
}

function resolve(value, stack = []) {
  if (typeof value === 'string') {
    return value.replace(/\{([^}]+)\}/g, (_, ref) => {
      if (stack.includes(ref)) {
        throw new Error(`Circular token reference: ${[...stack, ref].join(' -> ')}`);
      }
      const token = getByPath(ref);
      if (!isToken(token)) throw new Error(`Unknown token reference: ${ref}`);
      return String(resolve(token.$value, [...stack, ref]));
    });
  }
  return value;
}

function kebab(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function validateToken(token, tokenPath) {
  if (typeof token.$type !== 'string' || !supportedTypes.has(token.$type)) {
    throw new Error(`Unsupported or missing $type at ${tokenPath}: ${String(token.$type)}`);
  }

  const resolved = resolve(token.$value, [tokenPath]);

  if (token.$type === 'number') {
    if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
      throw new Error(`Token ${tokenPath} must resolve to a finite number.`);
    }
    return resolved;
  }

  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error(`Token ${tokenPath} must resolve to a non-empty string.`);
  }

  if (/[;{}\r\n]/.test(resolved)) {
    throw new Error(`Token ${tokenPath} contains characters that would break generated CSS.`);
  }

  if (token.$type === 'duration' && !/^(?:\d+|\d*\.\d+)(?:ms|s)$/.test(resolved)) {
    throw new Error(`Token ${tokenPath} must resolve to a CSS duration.`);
  }

  if (token.$type === 'cubicBezier' && !/^cubic-bezier\(\s*-?(?:\d+|\d*\.\d+)\s*,\s*-?(?:\d+|\d*\.\d+)\s*,\s*-?(?:\d+|\d*\.\d+)\s*,\s*-?(?:\d+|\d*\.\d+)\s*\)$/.test(resolved)) {
    throw new Error(`Token ${tokenPath} must resolve to cubic-bezier(x1, y1, x2, y2).`);
  }

  return resolved;
}

const declarations = [];
const generatedNames = new Map();

function walk(node, pathParts = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) {
      throw new Error(`Invalid token key: ${[...pathParts, key].join('.')}`);
    }

    const tokenPathParts = [...pathParts, key];
    const tokenPath = tokenPathParts.join('.');

    if (isToken(value)) {
      const name = '--' + tokenPathParts.map(kebab).join('-');
      const existingPath = generatedNames.get(name);
      if (existingPath) {
        throw new Error(`CSS variable name collision: ${existingPath} and ${tokenPath} both generate ${name}`);
      }
      generatedNames.set(name, tokenPath);

      const resolved = validateToken(value, tokenPath);
      declarations.push(`  ${name}: ${resolved};`);
      continue;
    }

    if (value && typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, '$type')) {
        throw new Error(`Token-like object is missing $value at ${tokenPath}.`);
      }
      walk(value, tokenPathParts);
      continue;
    }

    throw new Error(`Invalid token group value at ${tokenPath}.`);
  }
}

walk(tokens);

const css = `/* GENERATED FILE. Do not edit directly.\n   Source: tokens/design-tokens.json\n   Regenerate: node scripts/build-tokens.mjs */\n:root {\n${declarations.join('\n')}\n}\n`;

if (checkOnly) {
  if (!fs.existsSync(outputPath)) {
    throw new Error('css/tokens.css is missing. Run npm run build.');
  }
  const current = fs.readFileSync(outputPath, 'utf8');
  if (current !== css) {
    throw new Error('css/tokens.css is stale. Run npm run build and commit the regenerated file.');
  }
  console.log(`Verified ${path.relative(root, outputPath)} (${declarations.length} tokens)`);
} else {
  fs.writeFileSync(outputPath, css);
  console.log(`Wrote ${path.relative(root, outputPath)} (${declarations.length} tokens)`);
}
