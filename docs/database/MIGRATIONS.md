# Migrations

As migrations são append-only e numeradas:

- `0001_initial_schema.sql`: tabelas, constraints, FKs e índices;
- `0002_seed_categories.sql`: somente categorias/subgêneros reais da planilha.
- `0003_play_groups_and_imports.sql`: grupos reutilizáveis, vínculos opcionais, preservação de campanhas legadas e tipo dos jobs de importação.
- `0004_taxonomy_and_registered_group_members.sql`: taxonomia ampliada, vínculo opcional com contas cadastradas e narrador principal do grupo.
- `0005_worlds.sql`: Worlds, status/visibilidade e membership explícita.
- `0006_vault_entities.sql`: entidade-base do Vault, hierarquia de Locations e detalhes de Adventure.
- `0007_campaign_entities.sql`: vínculo N:N Campaign ↔ Entity e Adventure principal opcional.

Local: `npm run db:migrate:local`. Produção: exporte o backup JSON, inspecione `d1_migrations`, revise o SQL e só então rode `npm run db:migrate:remote`. As migrations 0005–0009 são aditivas: não reescrevem campanhas V1; vínculos novos começam como `NULL`/vazios e a preferência visual começa em `SYSTEM`. Não edite uma migration já aplicada; crie a próxima. Mudanças destrutivas devem usar migration específica, cópia de segurança e plano de rollback testado.

Após aplicar 0005–0007, valide `PRAGMA foreign_key_check`, confirme as tabelas `worlds`, `vault_entities` e `campaign_entities`, e execute um smoke de campanha V1 sem Adventure/World.

O Wrangler mantém o histórico em `d1_migrations`. Testes automatizados usam uma instância local isolada e nunca recebem o binding remoto.
