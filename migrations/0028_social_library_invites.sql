-- F-017/F-018 (BATCH8): Biblioteca social + convites de Grupo/Campanha para amigos.
-- Fecha a vertical Social (F-016..F-019) — dependência técnica de F-016, já DONE.

-- F-017: opt-in explícito de visibilidade (ninguém vê a Biblioteca de outra conta por
-- padrão) + interesse social separado do campo pessoal `rpgs.wants_to_play` (que
-- continua privado — nunca exposto a amigos).
ALTER TABLE user_preferences ADD COLUMN library_visible_to_friends INTEGER NOT NULL DEFAULT 0 CHECK(library_visible_to_friends IN (0,1));

CREATE TABLE rpg_social_interest (
  rpg_id TEXT PRIMARY KEY REFERENCES rpgs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

-- F-018: convite explícito (proposta), distinto do fluxo já existente de adicionar
-- qualquer conta cadastrada diretamente como membro (src/server/routes/groups.ts,
-- campaigns.ts — esse continua existindo, sem mudança). Convite só pode ser criado
-- pelo dono do Grupo/Campanha, só para quem já é amigo dele (F-016), e só vira
-- membro de fato quando o convidado aceita. `target_id` não tem FK própria (aponta
-- para play_groups OU campaigns conforme target_type) — a checagem de ownership é
-- feita em código, no mesmo padrão de authZ do resto do produto.
CREATE TABLE social_invites (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('GROUP','CAMPAIGN')),
  target_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER' CHECK(role IN ('PLAYER','GM')),
  created_at TEXT NOT NULL,
  CHECK(inviter_user_id <> invitee_user_id)
);
CREATE UNIQUE INDEX idx_social_invites_invitee_target ON social_invites(invitee_user_id, target_type, target_id);
CREATE INDEX idx_social_invites_target ON social_invites(target_type, target_id);

-- Amplia notifications.kind (fechado desde a migration 0027) para os eventos de
-- F-018. Seguro recriar aqui: nenhuma tabela referencia notifications.id via FK
-- (auditado) e a tabela está vazia em produção — mesmo assim segue o procedimento
-- de docs/architecture/DATABASE_MIGRATION_SAFETY.md por disciplina/precedente para
-- a próxima vez que uma tabela COM filhos precisar do mesmo tratamento.
CREATE TABLE notifications_rebuild (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('FRIEND_REQUEST_RECEIVED','FRIEND_REQUEST_ACCEPTED','SOCIAL_INVITE_RECEIVED','SOCIAL_INVITE_ACCEPTED')),
  payload_json TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO notifications_rebuild (id,user_id,kind,payload_json,read_at,created_at)
  SELECT id,user_id,kind,payload_json,read_at,created_at FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_rebuild RENAME TO notifications;
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
