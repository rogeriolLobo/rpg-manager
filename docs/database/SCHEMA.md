# Schema D1

- `users`: identidade mínima e password hash; e-mail normalizado único.
- `auth_sessions`: sessões opacas derivadas, expiração e revogação.
- `account_recovery_codes`: códigos derivados e consumo único.
- `security_events`: trilha técnica sem segredos.
- `auth_rate_limits`: falhas e bloqueio progressivo por chave derivada.
- `categories` / `subgenres`: taxonomia global versionada, com 18 categorias e 113 subgêneros relacionados por FK.
- `rpgs`: catálogo privado, status de leitura/mesa e índices de filtros.
- `campaigns`: planejamento privado vinculado a um RPG do usuário.
- `campaign_members`: jogadores/personagens normalizados.
- `campaign_sessions`: histórico e numeração calculada no servidor.
- `campaign_session_attendance`: relação N:N entre sessão e membro.
- `user_preferences`: preferências extensíveis por usuário, incluindo visualização da biblioteca, tema e `active_world_id` opcional.
- `import_jobs`: prévias temporárias, hash idempotente e confirmação.
- `play_groups` e `play_group_members`: grupos reutilizáveis, convidados e contas vinculadas; um narrador principal por grupo.
- `rpgs.play_group_id` e `campaigns.play_group_id`: vínculo opcional sem remover os textos legados.
- `campaign_members.group_member_id`: origem rastreável do membro copiado de um grupo.
- `play_group_members.user_id` / `campaign_members.user_id`: identidade cadastrada opcional com nome histórico preservado após exclusão.
- `worlds` / `world_members`: cenários reutilizáveis, owner, viewers explícitos e arquivamento não destrutivo.
- `vault_entities`: base comum para os onze tipos de conteúdo, com World/grupo/Location pai opcionais e visibilidade centralizada.
- `adventure_details`: extensão 1:1 exclusiva de entidades `ADVENTURE`, com premissa, ganchos, cenas-chave e recompensas.
- `lore_details`: extensão 1:1 de Lore com classificação, estado editorial e fonte.
- `campaign_entities`: vínculo N:N reutilizável entre campanhas e conteúdo do Vault.
- `campaigns.adventure_entity_id`: Adventure principal opcional; campanhas V1 permanecem válidas com `NULL`.
- `wiki_folders` / `wiki_entity_metadata`: navegação editorial que aponta para a entidade original do Vault.
- `world_tags` / `wiki_entity_tags`: tags locais ao World sem efeito de autorização.
- `wiki_entity_aliases`: nomes alternativos normalizados para navegação e busca.
- `journal_folders` / `journal_pages`: preparação privada do owner do World.
- `world_invites`: hashes de convite com validade, limite de uso e revogação; o código em texto puro não é persistido.
- `entity_relations`: arestas explícitas entre duas entidades do mesmo World, com tipo, direção, visibilidade, força, autoria e arquivamento.
- `world_eras`: períodos nomeados e ordenáveis dentro do World.
- `world_calendars`: definição única e validada de meses, dias da semana, ciclos e feriados por World.
- `event_temporal_details`: extensão 1:1 de EVENT com data textual, `sort_key`, precisão, era e data de calendário fictício.

UUIDs aleatórios são gerados no Worker. A exclusão de conta apaga sessões e códigos, anonimiza a identidade e preserva o registro tombstone para manter RPGs, Worlds, entidades, campanhas e histórico. Checks limitam enums, estados e booleanos. `RESTRICT` protege World/Entity contra exclusão destrutiva; `CASCADE` remove somente relações subordinadas sem identidade própria. Relações usam FKs `RESTRICT`, não apagam entidades e possuem índice único parcial para impedir duplicatas ativas. Os índices cobrem sessão, catálogo, campanhas, Worlds, filtros do Vault, relações semânticas e vínculos de membership.

O schema executável e único fonte de verdade está em `migrations/`.
