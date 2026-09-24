# `tokens`

Design tokens do design system, gerados com [Style Dictionary](https://styledictionary.com) a partir do export do Tokens Studio (Figma).

## Fonte

`src/tokens-studio/prizm.json` — export do Tokens Studio no formato DTCG (`$value`/`$type`). Os temas e sets são lidos do próprio arquivo (`$themes[].selectedTokenSets`), sem nada fixo no código.

## Comandos

- `pnpm build` — gera os arquivos em `dist/`
- `pnpm dev` — gera e observa `src/tokens-studio`, refazendo o build a cada alteração

## Saída (`dist/`)

| Arquivo | Conteúdo |
|---|---|
| `css/primitives.css`, `css/foundations.css` | Variáveis CSS compartilhadas por todos os temas |
| `css/color-modes/<tema>.css` | Variáveis específicas de cada tema do grupo `BRANDS`. Temas com "dark" no nome ficam dentro de `@media (prefers-color-scheme: dark)` |
| `js/<tema>.js` + `.d.ts` | Tokens do tema como constantes ES6 |
| `tailwind/preset.cjs` | Preset do Tailwind apontando para as variáveis CSS (`var(--...)`) |

As regras de agrupamento (sets por tema, `PATTERNS`/`COMPS`, plataforma desktop/mobile, referências quebradas) estão documentadas nos comentários de `build.mjs`.
