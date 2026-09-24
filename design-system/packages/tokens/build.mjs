import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import StyleDictionary from 'style-dictionary';
import { fileHeader, formattedVariables } from 'style-dictionary/utils';
import { register, expandTypesMap } from '@tokens-studio/sd-transforms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = path.join(__dirname, 'src/tokens-studio');
const DIST_DIR = path.join(__dirname, 'dist');

register(StyleDictionary);

// ---------------------------------------------------------------------------
// Preprocessors / formats
// ---------------------------------------------------------------------------

// Some color tokens in this project are exported as
// { colorSpace, components, alpha, hex } instead of a plain string, but with
// `components`/`alpha` as comma-separated strings rather than the numeric
// arrays the DTCG color spec expects. Neither Style Dictionary nor
// sd-transforms can parse that shape, so this preprocessor swaps it for the
// `hex` field, which is always present and always valid.
StyleDictionary.registerPreprocessor({
  name: 'ds/flatten-color-object',
  preprocessor(dictionary) {
    const flatten = (node) => {
      if (!node || typeof node !== 'object') return;

      if (
        node.$type === 'color' &&
        node.$value &&
        typeof node.$value === 'object' &&
        !Array.isArray(node.$value) &&
        typeof node.$value.hex === 'string'
      ) {
        node.$value = node.$value.hex;
        return;
      }

      for (const value of Object.values(node)) {
        flatten(value);
      }
    };

    flatten(dictionary);
    return dictionary;
  },
});

// Maps a token's category (the path segment right after a shared brand
// namespace, if any — see stripCommonNamespace below) to the Tailwind theme
// key it should be exposed under. This is a curated list of well-known
// names; categories not listed here still get included (see
// resolveTailwindEntry's fallback) so a rename in Figma can't silently drop
// tokens from the preset, it just needs its own key reviewed/renamed here.
const CATEGORY_TO_THEME_KEY = {
  color: 'colors',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'letter-spacing': 'letterSpacing',
  'line-height': 'lineHeight',
  corner: 'borderRadius',
  radii: 'borderRadius',
  border: 'borderWidth',
  'border-width': 'borderWidth',
  opacity: 'opacity',
  blur: 'blur',
  size: 'spacing',
  spacing: 'spacing',
  gap: 'gap',
  padding: 'padding',
  margin: 'margin',
  scale: 'scale',
  ratio: 'aspectRatio',
};

const MOTION_THEME_KEY = {
  duration: 'transitionDuration',
  delay: 'transitionDelay',
  easing: 'transitionTimingFunction',
};

function tokenKeyFrom(pathSegments, fallback) {
  const key = pathSegments.map((segment) => segment.replace(/^\$/, '')).join('-');
  return key || fallback;
}

function toCamelCase(value) {
  return value.replace(/[-_](\w)/g, (_, char) => char.toUpperCase());
}

// If every token in the dictionary shares the same first path segment (a
// brand/product namespace like "prizm"), it carries no category information
// on its own, so it's skipped for the purpose of picking a Tailwind key.
function commonNamespaceOffset(tokens) {
  const firstSegments = new Set(tokens.map((t) => t.path[0]));
  return firstSegments.size === 1 ? 1 : 0;
}

function resolveTailwindEntry(token, offset) {
  const top = token.path[offset];
  const second = token.path[offset + 1];

  if (top === 'motion') {
    const themeKey = MOTION_THEME_KEY[second];
    if (!themeKey) return null;
    return { themeKey, tokenKey: tokenKeyFrom(token.path.slice(offset + 2), second) };
  }

  const themeKey = CATEGORY_TO_THEME_KEY[top] ?? toCamelCase(top);
  return { themeKey, tokenKey: tokenKeyFrom(token.path.slice(offset + 1), top) };
}

// Points every token at its CSS custom property instead of a resolved value,
// so the preset stays valid across themes (color modes swap which CSS file
// is active, not this file).
StyleDictionary.registerFormat({
  name: 'tailwind/preset',
  format({ dictionary }) {
    const theme = {};
    const offset = commonNamespaceOffset(dictionary.allTokens);

    for (const token of dictionary.allTokens) {
      const entry = resolveTailwindEntry(token, offset);
      if (!entry) continue;

      theme[entry.themeKey] ??= {};
      theme[entry.themeKey][entry.tokenKey] = `var(--${token.name})`;
    }

    return `/**\n * Do not edit directly, this file was auto-generated.\n */\nmodule.exports = {\n  theme: {\n    extend: ${JSON.stringify(theme, null, 2)},\n  },\n};\n`;
  },
});

// A color mode only carries its own delta (e.g. "bg", "regular", "bold"),
// never the shared primitives — those live in primitives.css. A mode whose
// name contains "dark" is wrapped in a prefers-color-scheme query instead of
// being selector-scoped, so switching themes needs no extra attribute/class.
StyleDictionary.registerFormat({
  name: 'css/color-mode',
  async format({ dictionary, file, options }) {
    const header = await fileHeader({ file, options });
    const declarations = formattedVariables({ format: 'css', dictionary, usesDtcg: options.usesDtcg });
    const root = `:root {\n${declarations}\n}\n`;
    return header + (file.options?.dark ? `@media (prefers-color-scheme: dark) {\n${root}}\n` : root);
  },
});

// ---------------------------------------------------------------------------
// Manifest discovery — themes and sets are derived from the Tokens Studio
// export itself (its embedded $themes[].selectedTokenSets), never hardcoded.
// ---------------------------------------------------------------------------

const BASE_SET_PATTERNS = [
  ['primitives', /primitives|^0?1[\s._-]/i],
  ['foundations', /foundations|^0?2[\s._-]/i],
  ['components', /components?\b|\bcomps?\b|^0?3[\s._-]/i],
];

// Sets meant only for designers to see inside Figma (never exported to
// code), by the common Tokens Studio "DESIGN_ONLY" naming convention.
const EXCLUDED_SET_PATTERN = /design[-_ ]?only/i;

function classifyBaseSet(setKey) {
  for (const [bucket, pattern] of BASE_SET_PATTERNS) {
    if (pattern.test(setKey)) return bucket;
  }
  // Unrecognized base sets still need a home; foundations is the closest fit.
  return 'foundations';
}

function slugify(setKey) {
  return setKey.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The Tokens Studio export can define multiple independent theme
// *dimensions* as groups (e.g. BRANDS for light/dark, PLATFORM for
// mobile/desktop, PATTERNS, COMPS...), meant to be combined rather than
// picked one at a time. This project only treats "BRANDS" as the color-mode
// dimension that gets its own CSS/JS output. If it's renamed/moved to a
// different group in Figma, update COLOR_MODE_THEME_GROUP to match.
const COLOR_MODE_THEME_GROUP = 'BRANDS';

// PATTERNS/COMPS sets (Button, Link, states, backgrounds, foregrounds...)
// aren't brand-specific themselves, but their tokens reference brand-scoped
// semantic tokens (e.g. "fg.moderate.default") that only exist once a
// BRANDS theme is picked. So instead of going into the shared base, each of
// these is built into *every* color mode, alongside that mode's own delta.
const THEME_DEPENDENT_SET_PATTERN = /\/PATTERNS\/|\/COMPS\//i;

// PLATFORM sets (Mobile/Desktop) define the same token names with different
// values, so they collide if both end up in the shared base. Until the
// project has an actual responsive/platform output dimension, only the
// desktop set is kept (forced into base, ahead of the PATTERNS/COMPS rule
// above) and mobile is dropped entirely.
const PLATFORM_DESKTOP_SET_PATTERN = /\/Forms\/desktop$/i;
const PLATFORM_MOBILE_SET_PATTERN = /\/Forms\/mobile$/i;

// The current Figma/Tokens Studio export has references that point at
// tokens which don't exist anywhere in core.json (most likely renamed or
// deleted variables whose export went stale). By default Style Dictionary
// treats that as fatal; downgrading it to a warning lets the build finish
// instead of hard-failing the whole pipeline — the affected custom
// properties are simply omitted from output until the source is fixed. Grep
// the build log for "which is not defined" to see the current list.
const LOG_CONFIG = { errors: { brokenReferences: 'console' } };

async function loadManifest() {
  const files = (await readdir(TOKENS_DIR)).filter((f) => f.endsWith('.json'));
  const raw = {};
  let themes;

  for (const file of files) {
    const content = JSON.parse(await readFile(path.join(TOKENS_DIR, file), 'utf-8'));
    if (Array.isArray(content.$themes)) themes = content.$themes;
    for (const [key, value] of Object.entries(content)) {
      if (key.startsWith('$')) continue;
      raw[key] = value;
    }
  }

  if (!themes?.length) {
    throw new Error(`No "$themes" array found in any *.json file under ${TOKENS_DIR}`);
  }

  const colorModeThemes = themes.filter((theme) => theme.group === COLOR_MODE_THEME_GROUP);
  if (colorModeThemes.length === 0) {
    throw new Error(
      `No theme with group "${COLOR_MODE_THEME_GROUP}" found in $themes. ` +
        `Update COLOR_MODE_THEME_GROUP in build.mjs to match the theme group used for color modes.`,
    );
  }

  const perThemeEnabled = colorModeThemes.map((theme) => ({
    name: theme.name,
    enabled: Object.entries(theme.selectedTokenSets ?? {})
      .filter(([, status]) => status === 'enabled')
      .map(([key]) => key),
  }));
  const modeSetKeys = new Set(perThemeEnabled.flatMap((t) => t.enabled));

  const candidateBaseKeys = Object.keys(raw).filter(
    (key) =>
      !modeSetKeys.has(key) &&
      !EXCLUDED_SET_PATTERN.test(key) &&
      !PLATFORM_MOBILE_SET_PATTERN.test(key),
  );

  const isThemeDependent = (key) =>
    THEME_DEPENDENT_SET_PATTERN.test(key) && !PLATFORM_DESKTOP_SET_PATTERN.test(key);
  const themeDependentSetKeys = candidateBaseKeys.filter(isThemeDependent);
  const baseSetKeys = candidateBaseKeys.filter((key) => !isThemeDependent(key));

  const themeManifest = perThemeEnabled.map(({ name, enabled }) => ({
    name,
    modeSetKeys: [...enabled, ...themeDependentSetKeys],
  }));

  const baseBuckets = { primitives: [], foundations: [], components: [] };
  for (const key of baseSetKeys) {
    baseBuckets[classifyBaseSet(key)].push(key);
  }

  return { raw, themes: themeManifest, baseSetKeys, baseBuckets };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

// Each set is written to its own temp file, unwrapped from its set-key, so
// Style Dictionary's normal multi-source merge flattens them into one token
// tree and tags every token with the originating file — which is how output
// files are later filtered back down to just their own set(s).
async function materializeSets(tmpDir, raw, setKeys) {
  const fileForSet = new Map();
  for (const key of setKeys) {
    const fileName = `${slugify(key)}.json`;
    await writeFile(path.join(tmpDir, fileName), JSON.stringify(raw[key]));
    fileForSet.set(key, fileName);
  }
  return fileForSet;
}

// A token whose reference couldn't be resolved (see LOG_CONFIG above) keeps
// its literal "{a.b.c}" value instead of a real one, and — because the
// transform that failed also drives its name — can collapse to a bare,
// sometimes reserved-word name like "default". Left in, that produces
// broken CSS values and invalid JS (`export const default = ...`), so every
// output file filters these out until the source reference is fixed.
function isResolved(token) {
  // On a broken reference, resolution never completes: `token.value` is left
  // undefined and only `token.$value` still holds the raw "{a.b.c}" string.
  const candidate = token.value ?? token.$value;
  const raw = typeof candidate === 'string' ? candidate : JSON.stringify(candidate ?? '');
  return !/\{[^{}]+\}/.test(raw);
}

function filterBySets(fileForSet, setKeys) {
  const fileNames = new Set(setKeys.map((key) => fileForSet.get(key)));
  return (token) => fileNames.has(path.basename(token.filePath ?? '')) && isResolved(token);
}

function sourcePaths(tmpDir, fileForSet, setKeys) {
  return setKeys.map((key) => path.join(tmpDir, fileForSet.get(key)).replace(/\\/g, '/'));
}

async function buildBase(tmpDir, fileForSet, baseSetKeys, baseBuckets) {
  if (baseSetKeys.length === 0) return;

  const files = Object.entries(baseBuckets)
    .filter(([, keys]) => keys.length > 0)
    .map(([bucket, keys]) => ({
      destination: `${bucket}.css`,
      format: 'css/variables',
      filter: filterBySets(fileForSet, keys),
    }));

  if (files.length === 0) return;

  const sd = new StyleDictionary({
    source: sourcePaths(tmpDir, fileForSet, baseSetKeys),
    preprocessors: ['ds/flatten-color-object', 'tokens-studio'],
    expand: { typesMap: expandTypesMap },
    log: LOG_CONFIG,
    platforms: {
      css: {
        transformGroup: 'tokens-studio',
        transforms: ['name/kebab'],
        buildPath: 'dist/css/',
        files,
      },
    },
  });

  await sd.buildAllPlatforms();
}

async function buildTheme(tmpDir, fileForSet, baseSetKeys, theme) {
  const isDark = /dark/i.test(theme.name);
  const slug = theme.name.toLowerCase();

  const sd = new StyleDictionary({
    source: sourcePaths(tmpDir, fileForSet, [...baseSetKeys, ...theme.modeSetKeys]),
    preprocessors: ['ds/flatten-color-object', 'tokens-studio'],
    expand: { typesMap: expandTypesMap },
    log: LOG_CONFIG,
    platforms: {
      css: {
        transformGroup: 'tokens-studio',
        transforms: ['name/kebab'],
        buildPath: 'dist/css/color-modes/',
        files: [
          {
            destination: `${slug}.css`,
            format: 'css/color-mode',
            filter: filterBySets(fileForSet, theme.modeSetKeys),
            options: { dark: isDark },
          },
        ],
      },
      js: {
        transformGroup: 'tokens-studio',
        transforms: ['name/camel'],
        buildPath: 'dist/js/',
        files: [
          { destination: `${slug}.js`, format: 'javascript/es6', filter: isResolved },
          { destination: `${slug}.d.ts`, format: 'typescript/es6-declarations', filter: isResolved },
        ],
      },
    },
  });

  await sd.buildAllPlatforms();
}

// Token *names* are shared across color modes by convention (a mode only
// overrides values, not the set of tokens), so a single representative theme
// is enough to enumerate every name for the preset. Combining more than one
// theme's mode set here would merge their conflicting raw values into one
// source tree for no benefit, which Style Dictionary flags as a collision.
async function buildTailwindPreset(tmpDir, fileForSet, baseSetKeys, themes) {
  const [representativeTheme] = themes;
  const allSetKeys = [...baseSetKeys, ...(representativeTheme?.modeSetKeys ?? [])];

  const sd = new StyleDictionary({
    source: sourcePaths(tmpDir, fileForSet, allSetKeys),
    preprocessors: ['ds/flatten-color-object', 'tokens-studio'],
    expand: { typesMap: expandTypesMap },
    log: LOG_CONFIG,
    platforms: {
      tailwind: {
        transformGroup: 'tokens-studio',
        transforms: ['name/kebab'],
        buildPath: 'dist/tailwind/',
        files: [{ destination: 'preset.cjs', format: 'tailwind/preset', filter: isResolved }],
      },
    },
  });

  await sd.buildAllPlatforms();
}

async function build() {
  const { raw, themes, baseSetKeys, baseBuckets } = await loadManifest();
  const allSetKeys = [...new Set([...baseSetKeys, ...themes.flatMap((t) => t.modeSetKeys)])];

  // Cleaned once up front instead of per Style Dictionary instance: the
  // builds below run in parallel and share dist/, so a per-instance
  // cleanAllPlatforms() can delete files/dirs another build is writing.
  await rm(DIST_DIR, { recursive: true, force: true });

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ds-tokens-'));
  try {
    const fileForSet = await materializeSets(tmpDir, raw, allSetKeys);

    await Promise.all([
      buildBase(tmpDir, fileForSet, baseSetKeys, baseBuckets),
      ...themes.map((theme) => buildTheme(tmpDir, fileForSet, baseSetKeys, theme)),
      buildTailwindPreset(tmpDir, fileForSet, baseSetKeys, themes),
    ]);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `[tokens] built base (${Object.entries(baseBuckets).filter(([, k]) => k.length).map(([b]) => b).join(', ')}), ` +
      `${themes.length} color mode(s) (${themes.map((t) => t.name).join(', ')}), and the tailwind preset`,
  );
}

async function main() {
  await build();

  if (process.argv.includes('--watch')) {
    console.log('[tokens] watching src/tokens-studio for changes...');
    watch(TOKENS_DIR, { recursive: true }, async (_event, filename) => {
      try {
        console.log(`[tokens] ${filename} changed, rebuilding...`);
        await build();
      } catch (error) {
        console.error('[tokens] build failed:', error);
      }
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
