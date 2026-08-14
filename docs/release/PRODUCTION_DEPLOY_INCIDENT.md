# Incidente: produção não refletia a navegação corrigida

Data: 2026-08-14.

## Sintoma

Produção (`/app`, sem World ativo) mostrava a sidebar antiga:

```
Visão geral
Biblioteca
Grupos
Mundos
Configurações
Segurança
Perfil
```

Sem **Vault** e **Campanhas** nos links globais — violando
`docs/product/UX_INVARIANTS.md`.

## Causa raiz

**A correção de navegação nunca foi commitada.** `git status` mostrou
`src/client/components/app-shell.tsx` e `src/client/world-knowledge.css`
como alterações não commitadas na árvore de trabalho desde antes desta
sessão. `git log` não tinha nenhum commit correspondente; `origin/main`
era idêntico ao HEAD local (nenhuma divergência). Não foi deploy ausente
por branch errada, Worker errado, cache ou service worker — foi
simplesmente **código pronto que nunca chegou a ser publicado**, porque
nunca foi commitado.

Não existe service worker no projeto (confirmado por busca — descartado
como hipótese).

## Bug encontrado antes de publicar

Ao revisar o código pendente antes de commitar, encontrei um bug real:
a seção do World ativo usava `aria-label={`World · ${name}`}`, que
colide (correspondência por substring do Playwright/ARIA) com o rótulo
"World" do formulário de entidade do Vault — reproduzido pela falha
existente em `vault-worlds-flow.spec.ts` (`getByLabel('World')` resolvia
2 elementos). Corrigido para `aria-label={`Seção de ${name}`}`, que não
contém mais a substring "World".

## Cadeia commit → build → deployment → produção

| Etapa | Valor |
|---|---|
| Local HEAD | `f0498ac` |
| origin/main | `f0498ac` (idêntico) |
| Build | `dist/client/assets/index-BFmwpDW0.js` (confirmado por grep: contém "Vault", "Campanhas", "Geral", "Sistema") |
| Worker deployment | Version `bf0f9fa9-8e04-4171-bc3b-b7040e167b7a`, 100% do tráfego |
| Produção | `index.html` referencia `index-BFmwpDW0.js`; bundle buscado via HTTP direto contém as mesmas strings; `GET /api/v1/version` retorna `{"commit":"f0498ac",...}` |

Todos os elos correspondem à mesma versão lógica.

## Auditoria de configuração Cloudflare

- Worker único: `rpg-manager` (nome em `wrangler.jsonc`).
- Conta: `Editorahuginnemuninn@gmail.com's Account`.
- Sem `routes` customizadas — servido só via
  `rpg-manager.editorahuginnemuninn.workers.dev`.
- Sem Cloudflare Pages envolvido (projeto usa Workers Static Assets, não
  Pages) — sem conflito Pages+Worker possível.
- `wrangler deployments list` confirma histórico linear de deploys, um
  único Worker, sem environment duplicado.

## Achado colateral: cache de borda transitório no `/api/v1/version`

A primeíssima requisição ao endpoint novo (`/api/v1/version`), feita
segundos após o deploy, retornou `401 UNAUTHENTICATED` — resquício do
comportamento *anterior* ao deploy (antes da rota existir, o
catch-all de autenticação respondia para qualquer `/api/v1/*`
desconhecido). Uma nova requisição (com ou sem cache-bust) segundos
depois já retornou o valor correto. Isso é propagação normal de borda
do Cloudflare (poucos segundos), não um bug de cache do Worker — não
há `Cache-Control` explícito nas respostas de API, e o comportamento se
autocorrigiu sem nenhuma ação. Registrado aqui só por transparência.

## Prevenção: `GET /api/v1/version`

Adicionado nesta sessão. `npm run deploy` agora roda
`scripts/generate-build-info.mjs` antes do build, gravando o commit
real e o horário em `src/server/build-info.ts` (o arquivo commitado é
só um placeholder `'dev'/'unknown'`, sempre regenerado, nunca editado à
mão). O endpoint é público, sem autenticação, sem dados sensíveis
(coberto por teste de integração que confirma a ausência de
`secret|token|password|pepper` no corpo da resposta). Também exibido
discretamente em Configurações → Sobre.

Este mecanismo permite, a partir de agora, confirmar em runtime que
`main == build == deployment == produção` sem depender de memória ou
de relatórios anteriores.

## Resultado

- Commits: `03c1a26` (feature de navegação + fix de aria-label + testes),
  `b1f97df` (CI concurrency/paths-ignore), `d356ca9` (fix de seletor
  frágil em `navigation-invariants.spec.ts`), `bb9bf5f` (endpoint de
  versão), `f0498ac` (retry de CI + timeout de asserção).
- CI: verde em ambos os pushes relacionados a código (1 flake absorvido
  pelo retry interno novo, sem precisar de `gh run rerun`).
- Deploy final: Version `bf0f9fa9-8e04-4171-bc3b-b7040e167b7a`, 100% do
  tráfego, confirmado às 2026-08-14T19:55:34Z.
- D1: 30 RPGs, nenhuma escrita feita (só `SELECT`).
- Sidebar SEM World: confirmada via bundle de produção (strings
  "Geral", "Vault", "Campanhas", "Sistema" presentes) — a validação
  visual autenticada real (clique na UI logada) continua bloqueada por
  Turnstile/CAPTCHA, mesma limitação documentada em
  `docs/bugs/RPG_EDIT_INVALID_DATA.md`. Única pendência manual real.
