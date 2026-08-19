-- F-016/F-019 (BATCH7): sistema social — amizades, bloqueios e notificações
-- in-app. Puramente aditiva, sem alterar `users` nem nenhuma tabela
-- existente (ver docs/architecture/DATABASE_MIGRATION_SAFETY.md).
--
-- Modelo: pedido pendente (`friend_requests`) e amizade confirmada
-- (`friendships`) são tabelas separadas, não um único status-machine numa
-- tabela — evita o estado ambíguo "quem pode aceitar isto?" sempre exigir
-- checar qual lado é requester. `friendships` usa par canônico
-- (user_id_a < user_id_b, comparação de string do UUID) para impedir
-- duas linhas para o mesmo par em qualquer ordem, sem precisar de índice
-- de expressão.
CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(requester_user_id <> addressee_user_id)
);
CREATE UNIQUE INDEX idx_friend_requests_pair ON friend_requests(requester_user_id, addressee_user_id);
CREATE INDEX idx_friend_requests_addressee ON friend_requests(addressee_user_id);

CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  user_id_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_id_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(user_id_a < user_id_b)
);
CREATE UNIQUE INDEX idx_friendships_pair ON friendships(user_id_a, user_id_b);
CREATE INDEX idx_friendships_b ON friendships(user_id_b);

-- Bloquear é unilateral e independente de amizade — bloquear remove
-- qualquer pedido/amizade existente entre as duas contas (ver
-- src/server/routes/social.ts) e passa a impedir qualquer novo pedido nos
-- dois sentidos enquanto o bloqueio existir.
CREATE TABLE user_blocks (
  id TEXT PRIMARY KEY,
  blocker_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(blocker_user_id <> blocked_user_id)
);
CREATE UNIQUE INDEX idx_user_blocks_pair ON user_blocks(blocker_user_id, blocked_user_id);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_user_id);

-- F-019: notificações in-app, zero-cost (D1, sem push/e-mail). `kind`
-- fechado deliberadamente (mesma lição do LIB-004B: closed CHECK é seguro
-- para adicionar valor depois via migration aditiva, arriscado para
-- remover). `payload_json` guarda só IDs para o frontend buscar o recurso
-- atual (nunca um snapshot que possa ficar desatualizado ou vazar dado
-- que deixou de ser visível).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('FRIEND_REQUEST_RECEIVED','FRIEND_REQUEST_ACCEPTED')),
  payload_json TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
