# Design System

Monorepo do design system: tokens gerados a partir do Figma, componentes React e documentação em Storybook.

Ferramentas:

- [Turborepo](https://turborepo.dev) — orquestra build, dev e lint entre os pacotes, com cache
- [pnpm workspaces](https://pnpm.io/workspaces) — instala e liga os pacotes entre si (`workspace:*`)
- [Style Dictionary](https://styledictionary.com) + [Tokens Studio](https://tokens.studio) — transforma os tokens do Figma em CSS, JS e preset Tailwind
- [tsup](https://tsup.egoist.dev) — compila os componentes React
- [Storybook](https://storybook.js.org) — documentação e playground dos componentes
- [Changesets](https://github.com/changesets/changesets) — versionamento e changelog

## Estrutura

| Caminho | Pacote | Descrição |
|---|---|---|
| `packages/tokens` | `tokens` | Design tokens (ver [README](packages/tokens/README.md)) |
| `packages/ui` | `@acme/ui` | Componentes React |
| `apps/docs` | `docs` | Storybook |
| `packages/eslint-config` | `@repo/eslint-config` | Configurações de ESLint compartilhadas |
| `packages/typescript-config` | `@repo/typescript-config` | `tsconfig`s compartilhados |

## Comandos

Rode na pasta `design-system/`:

- `pnpm install` — instala as dependências
- `pnpm dev` — tokens e componentes em watch + Storybook em `localhost:6006`
- `pnpm build` — build de todos os pacotes, incluindo o Storybook estático
- `pnpm lint` — lint de todos os pacotes
- `pnpm preview-storybook` — serve o Storybook estático gerado pelo build
- `pnpm changeset` — registra uma mudança para o próximo versionamento
- `pnpm clean` — apaga `node_modules`, `dist` e caches

Para rodar a tarefa de um pacote só: `pnpm turbo run build --filter=tokens`.

## Adicionando um componente

1. Crie o arquivo em `packages/ui/src/` (ex.: `input.tsx`).
2. Adicione-o em `entryPoints` no `packages/ui/tsup.config.ts`.
3. Exporte-o em `exports` no `packages/ui/package.json`:

   ```json
   "./input": {
     "types": "./src/input.tsx",
     "import": "./dist/input.mjs",
     "require": "./dist/input.js"
   }
   ```

4. Crie a story em `apps/docs/stories/` (ex.: `input.stories.tsx`).
