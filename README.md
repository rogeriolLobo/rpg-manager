# RPG Manager

Aplicação full-stack para biblioteca, campanhas e sessões de RPG. React e a API Hono são publicados na mesma origem por um Cloudflare Worker; os dados privados ficam no Cloudflare D1 e todas as consultas são delimitadas pelo usuário autenticado.

## Pré-requisitos

- Node.js 22 ou superior;
- npm 10 ou superior;
- conta Cloudflare Free para publicar;
- Chromium do Playwright para os testes E2E.

## Instalação e desenvolvimento

```powershell
npm ci
Copy-Item .env.example .env
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Abra `http://127.0.0.1:5173`. Em desenvolvimento, Turnstile é dispensado pelo Worker; para exercitá-lo localmente, configure as chaves oficiais de teste em `.dev.vars` e `.env`. Nunca use um valor real em variável `VITE_*` além da site key pública. O binding `ENVIRONMENT=production` do Wrangler garante falha fechada no deploy; `.dev.vars` o substitui somente no ambiente local.

## Gates

```powershell
npm run lint
npm run typecheck
npm run test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run build
```

Os testes de integração usam D1 real no runtime local do Workers, isolado do banco remoto. O gate unitário gera `coverage/` e exige 85% em statements, branches, functions e lines para os módulos críticos incluídos.

## Banco e migrations

```powershell
npm run db:migrate:local
npm run db:migrate:remote
```

`db:seed:local` reaplica as migrations idempotentes e inclui somente categorias/subgêneros. Não existem usuários ou campanhas fictícios no seed. Leia [SCHEMA.md](docs/database/SCHEMA.md) e [MIGRATIONS.md](docs/database/MIGRATIONS.md) antes de alterar produção.

## Cloudflare e deploy

1. Autentique: `npx wrangler login`.
2. Crie ou vincule um D1 e mantenha o `database_id` real em `wrangler.jsonc`.
3. Configure `PASSWORD_PEPPER` e `TURNSTILE_SECRET_KEY` com `npx wrangler secret put NOME`.
4. Defina a site key pública no build: `$env:VITE_TURNSTILE_SITE_KEY='...'`.
5. Aplique migrations: `npm run db:migrate:remote`.
6. Publique: `npm run deploy`.

Detalhes e rollback estão em [CLOUDFLARE.md](docs/deployment/CLOUDFLARE.md). Nenhum comando do projeto cadastra cartão ou habilita plano pago.

## Importação e backup

Em **Configurações**, envie primeiro o CSV da aba `Catálogo de Livros` e depois, se necessário, o CSV da aba `Campanhas`. Ambos exigem prévia e confirmação. A cópia capturada do catálogo está em [google-sheets-catalog.csv](data/import/google-sheets-catalog.csv). JSON completo e CSV do catálogo podem ser baixados pela mesma tela. Consulte [GOOGLE_SHEETS.md](docs/import/GOOGLE_SHEETS.md).

## Grupos de jogo

Em **Grupos**, crie um grupo e seus jogadores. O grupo pode ser associado a vários RPGs e campanhas. Ao associá-lo a uma campanha, os membros ativos entram no elenco e podem receber personagem, notas e presença específicos. Consulte [ADR-003-play-groups.md](docs/architecture/ADR-003-play-groups.md).

## Estrutura

- `src/client`: React, rotas, formulários e estados de interface;
- `src/server`: API `/api/v1`, autenticação, segurança e acesso D1;
- `src/domain`: regras puras de ranking e planejamento;
- `src/shared`: validação runtime Zod;
- `migrations`: schema e dados de referência versionados;
- `tests`: unitários, integração Worker+D1 e E2E;
- `docs`: decisões, segurança, banco, importação e deploy.

## Troubleshooting

- `D1_ERROR: no such table`: execute `npm run db:migrate:local`.
- Cadastro retorna `TURNSTILE_REQUIRED`: confira as duas chaves e se o hostname está autorizado no widget.
- `401` após troca de senha: comportamento esperado; as sessões anteriores foram revogadas.
- E2E não inicia: rode `npx playwright install chromium` e verifique se a porta 5173 está livre.
- Erro remoto do Wrangler: confirme `npx wrangler whoami`, o account correto e as permissões D1/Workers.

Política de segurança: [SECURITY.md](docs/security/SECURITY.md). Visão arquitetural: [OVERVIEW.md](docs/architecture/OVERVIEW.md).
