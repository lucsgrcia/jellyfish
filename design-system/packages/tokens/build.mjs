import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import StyleDictionary from 'style-dictionary';
import { register } from '@tokens-studio/sd-transforms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = path.join(__dirname, 'src/tokens-studio');
const THEMES_FILE = path.join(TOKENS_DIR, '$themes.json');

register(StyleDictionary);

// Maps a token's top-level path segment (its Tokens Studio "category") to the
// Tailwind theme key it should be exposed under. Categories not listed here
// (e.g. the ad-hoc "jf" namespace, or the raw typography-composite deps like
// "fontFamilies"/"lineHeights") are intentionally left out of the preset.
const CATEGORY_TO_THEME_KEY = {
  color: 'colors',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'letter-spacing': 'letterSpacing',
  'line-height': 'lineHeight',
  corner: 'borderRadius',
  border: 'borderWidth',
  opacity: 'opacity',
  blur: 'blur',
  size: 'spacing',
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

function resolveTailwindEntry(token) {
  const [top, second] = token.path;

  if (top === 'motion') {
    const themeKey = MOTION_THEME_KEY[second];
    if (!themeKey) return null;
    return { themeKey, tokenKey: tokenKeyFrom(token.path.slice(2), second) };
  }

  const themeKey = CATEGORY_TO_THEME_KEY[top];
  if (!themeKey) return null;
  return { themeKey, tokenKey: tokenKeyFrom(token.path.slice(1), top) };
}

// Points every token at its CSS custom property instead of a resolved value,
// so the preset stays valid across themes (light/dark swap via the
// `[data-theme]` selector in the generated CSS, not by regenerating this file).
StyleDictionary.registerFormat({
  name: 'tailwind/preset',
  format({ dictionary }) {
    const theme = {};

    for (const token of dictionary.allTokens) {
      const entry = resolveTailwindEntry(token);
      if (!entry) continue;

      theme[entry.themeKey] ??= {};
      theme[entry.themeKey][entry.tokenKey] = `var(--${token.name})`;
    }

    return `/**\n * Do not edit directly, this file was auto-generated.\n */\nmodule.exports = {\n  theme: {\n    extend: ${JSON.stringify(theme, null, 2)},\n  },\n};\n`;
  },
});

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

async function getThemes() {
  const raw = await readFile(THEMES_FILE, 'utf-8');
  return JSON.parse(raw);
}

function themeToConfig(theme) {
  const source = Object.entries(theme.selectedTokenSets)
    .filter(([, status]) => status !== 'disabled')
    .map(([tokenSet]) => path.join(TOKENS_DIR, `${tokenSet}.json`).replace(/\\/g, '/'));

  const selector = theme.name === 'dark' ? '[data-theme="dark"]' : ':root';

  return {
    source,
    preprocessors: ['ds/flatten-color-object', 'tokens-studio'],
    platforms: {
      css: {
        transformGroup: 'tokens-studio',
        transforms: ['name/kebab'],
        buildPath: 'dist/css/',
        files: [
          {
            destination: `${theme.name}.css`,
            format: 'css/variables',
            options: { selector },
          },
        ],
      },
      js: {
        transformGroup: 'tokens-studio',
        transforms: ['name/camel'],
        buildPath: 'dist/js/',
        files: [
          {
            destination: `${theme.name}.js`,
            format: 'javascript/es6',
          },
          {
            destination: `${theme.name}.d.ts`,
            format: 'typescript/es6-declarations',
          },
        ],
      },
    },
  };
}

async function buildTheme(theme) {
  const sd = new StyleDictionary(themeToConfig(theme));
  await sd.cleanAllPlatforms();
  await sd.buildAllPlatforms();
}

// Token names are shared across themes, so the preset only needs to be built
// once, from the union of every token set referenced by any theme.
async function buildTailwindPreset(themes) {
  const tokenSets = new Set();
  for (const theme of themes) {
    for (const [tokenSet, status] of Object.entries(theme.selectedTokenSets)) {
      if (status !== 'disabled') tokenSets.add(tokenSet);
    }
  }

  const sd = new StyleDictionary({
    source: [...tokenSets].map((tokenSet) => path.join(TOKENS_DIR, `${tokenSet}.json`).replace(/\\/g, '/')),
    preprocessors: ['ds/flatten-color-object', 'tokens-studio'],
    platforms: {
      tailwind: {
        transformGroup: 'tokens-studio',
        transforms: ['name/kebab'],
        buildPath: 'dist/tailwind/',
        files: [
          {
            destination: 'preset.cjs',
            format: 'tailwind/preset',
          },
        ],
      },
    },
  });

  await sd.cleanAllPlatforms();
  await sd.buildAllPlatforms();
}

async function build() {
  const themes = await getThemes();
  await Promise.all([...themes.map(buildTheme), buildTailwindPreset(themes)]);
  console.log(`[tokens] built ${themes.length} theme(s): ${themes.map((t) => t.name).join(', ')}`);
  console.log('[tokens] built tailwind preset');
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
