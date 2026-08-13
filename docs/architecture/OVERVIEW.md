# Visão arquitetural

## Topologia

O navegador recebe o SPA React pelos Static Assets do mesmo Worker que atende `/api/v1`. A API valida entrada com Zod, deriva a identidade exclusivamente do cookie de sessão e acessa o D1 por prepared statements. Regras que precisam ser consistentes em várias telas ficam em `src/domain`.

```text
Browser -> Worker Static Assets -> React Router
        -> Worker /api/v1 -> middleware -> Hono routes -> D1
                                      -> Turnstile / Rate Limiting
```

## Limites de responsabilidade

- cliente: interação, acessibilidade, prévia e apresentação; nunca decide autorização ou pontuação;
- API: autenticação, autorização no SQL, validação, paginação e orquestração;
- domínio: pontuação, planejamento, resolução de visibilidade e invariantes de conteúdo;
- D1: integridade relacional, unicidade e persistência multiusuário;
- Cloudflare: TLS, execução, assets, rate limiting e Turnstile.

Toda rota privada usa o usuário da sessão. Recursos V1 de owner usam `id + user_id`; Worlds e entidades usam helpers centrais que resolvem ownership e membership de World, grupo ou campanha. Busca, filtro, paginação e autorização do Vault acontecem na mesma consulta para impedir vazamento por contagem ou payload. Erros têm schema estável e request ID, sem stack trace.

## Decisões

- [ADR-001](ADR-001-cloudflare-hosting.md): Workers + Static Assets e D1 no Free Plan.
- [ADR-002](ADR-002-authentication.md): autenticação interna estreita, baseada em Web Crypto e sessão opaca.
- [ADR-003](ADR-003-play-groups.md): grupos reutilizáveis, contas cadastradas e narrador principal.
- [ADR-004](ADR-004-vault-entity-model.md): entidade-base do Vault com extensões relacionais.
- [ADR-005](ADR-005-content-permissions.md): autorização por ownership, visibility e membership.

## Regra de recomendação

`calculateRpgRecommendationScore` soma: quero jogar +100; prioridade alta/média/baixa +40/+25/+10; lido +30; grupo +20; nunca jogado +20 ou já jogado -20; mesa preparando/agendada/em andamento +15/+20/+25. O desempate é: quero jogar, prioridade, lido, grupo e título. A API calcula e ordena; o cliente apenas exibe.
