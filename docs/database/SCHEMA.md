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
- `user_preferences`: preferências extensíveis por usuário.
- `import_jobs`: prévias temporárias, hash idempotente e confirmação.
- `play_groups` e `play_group_members`: grupos reutilizáveis, convidados e contas vinculadas; um narrador principal por grupo.
- `rpgs.play_group_id` e `campaigns.play_group_id`: vínculo opcional sem remover os textos legados.
- `campaign_members.group_member_id`: origem rastreável do membro copiado de um grupo.
- `play_group_members.user_id` / `campaign_members.user_id`: identidade cadastrada opcional com nome histórico preservado após exclusão.

UUIDs aleatórios são gerados no Worker. Exclusão de conta remove os dados privados por cascata deliberada; taxonomia é restringida. Checks limitam enums e booleanos. Os índices cobrem sessão por token/expiração, catálogo por usuário/filtros, campanhas por usuário e sessões por campanha/data.

O schema executável e único fonte de verdade está em `migrations/`.
