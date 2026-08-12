# ADR-001 — Hospedagem Cloudflare Workers + Static Assets

- Status: aceito
- Data: 2026-08-12

## Contexto e decisão

A V1 exige frontend React, API, banco persistente e custo mensal obrigatório de R$ 0,00. A aplicação será publicada como um único Cloudflare Worker, com Static Assets para o build Vite e execução do Worker somente em `/api/*`. O frontend e a API compartilham a origem, eliminando CORS e simplificando cookies/CSRF.

O D1 armazena dados privados e migrações versionadas. O Wrangler é a fonte de verdade da infraestrutura. Cloudflare Pages foi descartado porque a documentação atual recomenda Workers Static Assets para aplicações full-stack novas e o Workers Vite Plugin oferece runtime local próximo de produção.

## Limites e consequências

No plano Free confirmado em agosto de 2026: 100.000 invocações Worker/dia, 10 ms de CPU por requisição, 20.000 assets por versão; D1 inclui 5 milhões de linhas lidas/dia, 100.000 escritas/dia e até 500 MB por banco. Ao atingir limites, a aplicação pode responder erro até a renovação da cota; não haverá cobrança automática nem upgrade.

Assets estáticos são gratuitos e ilimitados em requests. Índices, paginação e consultas agregadas reduzem linhas lidas. Operações de autenticação serão medidas em produção por causa do limite de CPU.

## Alternativas

- Pages + Functions: funcional, mas sem vantagem para esta aplicação e não é a recomendação atual para novos full-stack.
- VPS/SaaS de banco: rejeitados por custo obrigatório.
- Google Sheets como banco: rejeitado por segurança, integridade e acoplamento.

