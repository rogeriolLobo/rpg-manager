# Deploy Cloudflare

## Recursos

- Worker `rpg-manager` com Static Assets;
- D1 `rpg-manager-production` via binding `DB`;
- binding `AUTH_RATE_LIMITER`;
- secrets `PASSWORD_PEPPER` e `TURNSTILE_SECRET_KEY`;
- variável pública de build `VITE_TURNSTILE_SITE_KEY`.

## Primeira publicação

```powershell
npx wrangler whoami
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
npx wrangler secret put PASSWORD_PEPPER
npx wrangler secret put TURNSTILE_SECRET_KEY
npm run db:migrate:remote
$env:VITE_TURNSTILE_SITE_KEY='site-key-publica'
npm run deploy
```

Configure o widget Turnstile para o hostname publicado. Não coloque o secret em `.env`, GitHub Variable ou `VITE_*`. Em CI, use GitHub Secrets e um environment `production`; PRs executam apenas validação.

## Smoke e rollback

Após publicar: valide `/api/v1/health`, headers, cadastro com Turnstile, sessão, uma campanha V1, criação de World, entidade privada, vínculo Campaign↔Entity e arquivamento/restauração. Para autorização compartilhada, use duas contas descartáveis e confirme que `GM_ONLY` não chega ao player. Exclua as contas ao fim. Se o Worker falhar, use o rollback de versões do Workers; migrations D1 já aplicadas não são revertidas pelo rollback do Worker e exigem migration compensatória revisada.

## Custo

A arquitetura foi escolhida para os limites Free. Monitore Workers e D1 no dashboard e interrompa crescimento/importações antes de atingir cotas. Não há fallback automático para recurso pago nem criação de cartão pelo projeto.
