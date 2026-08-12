# Migrations

As migrations são append-only e numeradas:

- `0001_initial_schema.sql`: tabelas, constraints, FKs e índices;
- `0002_seed_categories.sql`: somente categorias/subgêneros reais da planilha.

Local: `npm run db:migrate:local`. Produção: faça backup/exportação, revise o SQL e só então rode `npm run db:migrate:remote`. Não edite uma migration já aplicada; crie a próxima. Mudanças destrutivas devem usar uma migration específica, cópia de segurança e plano de rollback testado.

O Wrangler mantém o histórico em `d1_migrations`. Testes automatizados usam uma instância local isolada e nunca recebem o binding remoto.
