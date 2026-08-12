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
- API: autenticação, autorização, validação, paginação e orquestração;
- domínio: pontuação, desempate, etapa, progresso e próxima ação;
- D1: integridade relacional, unicidade e persistência multiusuário;
- Cloudflare: TLS, execução, assets, rate limiting e Turnstile.

Toda rota privada usa o usuário da sessão. RPGs usam `id + user_id`; recursos filhos passam primeiro por uma campanha pertencente ao usuário. Erros têm schema estável e request ID, sem stack trace.

## Decisões

- [ADR-001](ADR-001-cloudflare-hosting.md): Workers + Static Assets e D1 no Free Plan.
- [ADR-002](ADR-002-authentication.md): autenticação interna estreita, baseada em Web Crypto e sessão opaca.

## Regra de recomendação

`calculateRpgRecommendationScore` soma: quero jogar +100; prioridade alta/média/baixa +40/+25/+10; lido +30; grupo +20; nunca jogado +20 ou já jogado -20; mesa preparando/agendada/em andamento +15/+20/+25. O desempate é: quero jogar, prioridade, lido, grupo e título. A API calcula e ordena; o cliente apenas exibe.
