-- F-026 (BATCH14): Conteúdo oficial/licenciado — arquitetura de proveniência para
-- qualquer Vault Entity, SEM copiar/redistribuir texto protegido. content_source marca a
-- origem (USER_CREATED, padrão — nada muda para o que já existe; LICENSED — o usuário tem
-- direito de uso mas o conteúdo não é seu; OFFICIAL_REFERENCE — só uma referência/ponteiro
-- ao material oficial, ex. "Ver Livro X, p.34", nunca o texto integral). content_locked
-- protege a descrição de edição acidental de conteúdo oficial/licenciado já registrado
-- (aplicado em src/server/routes/vault.ts — precisa ser destravado explicitamente antes de
-- alterar a descrição). Se um item específico exigir bloqueio por licenciamento, ele é
-- marcado individualmente (content_source) — a feature/domínio nunca é bloqueada inteira.
-- Migration puramente aditiva — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md.

ALTER TABLE vault_entities ADD COLUMN content_source TEXT NOT NULL DEFAULT 'USER_CREATED' CHECK(content_source IN ('USER_CREATED','LICENSED','OFFICIAL_REFERENCE'));
ALTER TABLE vault_entities ADD COLUMN publisher TEXT NOT NULL DEFAULT '' CHECK(length(publisher) <= 160);
ALTER TABLE vault_entities ADD COLUMN edition TEXT NOT NULL DEFAULT '' CHECK(length(edition) <= 160);
ALTER TABLE vault_entities ADD COLUMN license_note TEXT NOT NULL DEFAULT '' CHECK(length(license_note) <= 2000);
ALTER TABLE vault_entities ADD COLUMN content_locked INTEGER NOT NULL DEFAULT 0 CHECK(content_locked IN (0,1));
CREATE INDEX idx_vault_content_source ON vault_entities(owner_user_id, content_source);
