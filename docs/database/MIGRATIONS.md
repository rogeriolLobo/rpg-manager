# Migrations

As migrations são append-only e numeradas:

- `0001_initial_schema.sql`: tabelas, constraints, FKs e índices;
- `0002_seed_categories.sql`: somente categorias/subgêneros reais da planilha.
- `0003_play_groups_and_imports.sql`: grupos reutilizáveis, vínculos opcionais, preservação de campanhas legadas e tipo dos jobs de importação.
- `0004_taxonomy_and_registered_group_members.sql`: taxonomia ampliada, vínculo opcional com contas cadastradas e narrador principal do grupo.
- `0005_worlds.sql`: Worlds, status/visibilidade e membership explícita.
- `0006_vault_entities.sql`: entidade-base do Vault, hierarquia de Locations e detalhes de Adventure.
- `0007_campaign_entities.sql`: vínculo N:N Campaign ↔ Entity e Adventure principal opcional.
- `0008_rpg_cover_metadata.sql`: origem e metadados verificáveis das capas do catálogo.
- `0009_theme_preference.sql`: preferência de tema claro, escuro ou sistema.
- `0010_active_world_and_wiki.sql`: World ativo, pastas, tags, aliases e organização editorial da Wiki.
- `0011_lore_adventure_and_journal.sql`: detalhes ampliados de Lore/Adventure e Diário privado.
- `0012_world_invites.sql`: convites com hash, expiração, limite de uso e revogação.
- `0013_entity_relations.sql`: relações semânticas, direção, visibilidade, força, arquivo e índices do grafo.
- `0014_world_timeline_calendar.sql`: eras, calendário fictício e detalhes temporais de EVENT.
- `0015_specialized_entities_bestiary.sql`: extensões universais de entidades e modelos/blocos configuráveis do Bestiário.

Local: `npm run db:migrate:local`. Produção: exporte o backup JSON, inspecione `d1_migrations`, revise o SQL e só então rode `npm run db:migrate:remote`. As migrations 0005–0009 são aditivas: não reescrevem campanhas V1; vínculos novos começam como `NULL`/vazios e a preferência visual começa em `SYSTEM`. Não edite uma migration já aplicada; crie a próxima. Mudanças destrutivas devem usar migration específica, cópia de segurança e plano de rollback testado.

Após aplicar 0010–0015, valide `PRAGMA foreign_key_check` e confirme as tabelas de Wiki, Diário, convites, relações, Timeline e Bestiário. Execute também smoke de campanha V1, Wiki owner, Portal viewer, grafo, Timeline e Bestiário vazio de um World existente.

O Wrangler mantém o histórico em `d1_migrations`. Testes automatizados usam uma instância local isolada e nunca recebem o binding remoto.
