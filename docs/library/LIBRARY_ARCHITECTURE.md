# Biblioteca — Decisão de Arquitetura (LIB-001)

## Decisão sobre o bug de coverUrl (implementada nesta sessão)

Ver `docs/library/COVER_STORAGE.md` para o desenho completo (atual +
futuro). Resumo da mudança já em produção: `coverUrl` deixou de ser
validada contra uma allowlist fixa de hosts + fetch do servidor, e
passou a ser validada só sintaticamente (HTTPS público, sem IP privado/
loopback, sem protocolo perigoso) — porque o servidor nunca busca essa
URL, só o navegador (`<img src>`). A CSP (`img-src`) foi ajustada em
conjunto para não bloquear no navegador o que o servidor já aceita.

## Decisão sobre o modelo de domínio (System → Publication → User State)

**Decisão: recomendar a evolução, mas NÃO implementá-la nesta sessão.**

### Por quê não agora

A separação proposta (`GameSystem` → `Publication` → estado pessoal por
usuário) é uma mudança de domínio real, não um ajuste de bug. Ela exige:

- nova(s) tabela(s) (`game_systems`, `publications` e uma tabela de
  associação `user_publications` para o estado pessoal — o `rpgs` atual
  viraria essa terceira tabela);
- migração de dados dos 30 registros reais de produção, preservando
  100% do conteúdo (nenhum campo pode ser perdido);
- reescrita de toda a camada de leitura (`present()`, filtros, busca,
  paginação, recomendação) para fazer `JOIN` em vez de `SELECT *`;
- reescrita do importer CSV para o novo modelo de duas (ou três)
  entidades;
- ampla bateria de testes de regressão para garantir que os 30 RPGs
  reais continuam idênticos, campo a campo, depois da migração.

Fazer isso com o mesmo rigor aplicado ao resto desta sessão (audit →
implement → test first → CI → deploy → smoke) não cabe com segurança na
mesma sessão que já corrigiu dois incidentes de produção e auditou o
1.0 inteiro. Implementar às pressas violaria diretamente a instrução do
próprio responsável do produto: "não faça feature pela metade" e "não
rewrite automaticamente".

### Caminho ADITIVO recomendado (quando for feito)

Duas opções avaliadas:

**Opção A — Tabelas novas, migração posterior (recomendada).**

```sql
CREATE TABLE game_systems (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  game_system_id TEXT REFERENCES game_systems(id) ON DELETE RESTRICT,
  publication_type TEXT NOT NULL CHECK(publication_type IN (
    'CORE_RULEBOOK','PLAYER_GUIDE','GM_GUIDE','SUPPLEMENT','SETTING',
    'ADVENTURE','ONE_SHOT','CAMPAIGN','BESTIARY','SCREEN','OTHER')),
  title TEXT NOT NULL,
  subtitle TEXT,
  edition TEXT,
  publisher TEXT,
  publication_year INTEGER,
  language TEXT,
  isbn10 TEXT,
  isbn13 TEXT,
  authors TEXT NOT NULL DEFAULT '[]',        -- JSON array
  description TEXT NOT NULL DEFAULT '',
  cover_type TEXT NOT NULL DEFAULT 'NONE' CHECK(cover_type IN ('NONE','EXTERNAL_URL','UPLOAD')),
  cover_asset_id TEXT,                       -- KV key, quando cover_type=UPLOAD
  external_cover_url TEXT,                   -- quando cover_type=EXTERNAL_URL
  cover_source_url TEXT,
  cover_source_note TEXT,
  metadata_source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(metadata_source IN ('MANUAL','OPEN_LIBRARY','GOOGLE_BOOKS')),
  metadata_source_id TEXT,
  metadata_source_url TEXT,
  metadata_fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_publications_isbn13 ON publications(isbn13) WHERE isbn13 IS NOT NULL;

-- rpgs vira o "estado pessoal": renomear seria destrutivo demais; o caminho
-- aditivo é uma nova coluna nullable publication_id em rpgs, preenchida por
-- uma migration de dados (não de schema) num passo separado e reversível.
ALTER TABLE rpgs ADD COLUMN publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL;
```

Isso é aditivo (`ALTER TABLE ADD COLUMN` nullable, `CREATE TABLE` novas)
— nenhum dado existente é tocado na migration de schema. A migração de
DADOS (criar uma `publication` para cada `rpgs` existente e apontar
`publication_id`) é um passo **separado**, escrito como script
idempotente, testado em D1 local com uma cópia dos 30 registros antes
de rodar contra produção — nunca como parte automática do deploy.

Os campos hoje em `rpgs` que são claramente editoriais (`cover_url`,
`isbn`, `cover_source_url`, `cover_source_note`) migrariam para
`publications`; os campos de estado pessoal (`reading_status`,
`has_played`, `wants_to_play`, `priority`, `play_group_notes`,
`play_group_id`, `planned_play_date`, `table_status`, `game_master`,
`notes`) continuam em `rpgs`, que passa a ser conceitualmente
`user_library_entries`.

**Opção B — manter tudo em `rpgs` indefinidamente.** Mais simples, mas
não suporta o requisito futuro de duas pessoas terem o mesmo livro na
biblioteca sem duplicar metadata, nem dedup real por ISBN entre
usuários diferentes. Viável só se o produto nunca precisar de
compartilhamento de biblioteca entre contas (contradiz a seção 27 do
pedido, que pede que a arquitetura não impeça isso no futuro).

**Recomendação: Opção A, em uma sessão dedicada**, com o mesmo processo
rigoroso (arquiteto → backend → frontend → QA → devops) usado nesta.

### O que a Opção A NÃO muda

- Nenhum RPG existente é perdido ou alterado incorretamente (migração
  de dados testada e reversível antes de tocar produção).
- A API pública (`GET/POST/PATCH /rpgs`) pode continuar retornando o
  formato atual (achatado) por compatibilidade, com `present()` fazendo
  o `JOIN` internamente — o frontend não precisa mudar no dia da
  migration.
- `UNIQUE(user_id, title)` pode ser substituído por dedup real (ISBN
  primeiro, provider+ID depois, título só como último recurso com
  preview de conflito) sem quebrar RPGs que não têm ISBN.

## Separação metadata editorial × estado pessoal

Já é conceitualmente clara no código atual (`present()` distingue os
dois grupos de campos na resposta), só não é fisicamente separada em
tabelas. A Opção A formaliza fisicamente uma separação que já existe
logicamente — reduz risco de "vazamento" de provenance externa para
campos pessoais (seção 19 do pedido), porque campos de metadata (com
`metadata_source`) passam a viver numa tabela que só o dono da
publicação (ou, no futuro, qualquer usuário que a referencie) edita,
separada da tabela de estado pessoal por usuário.

## Suporte a publicações futuras (System → Core Book → Adventure → Campaign)

A Opção A já modela isso via `publication_type` (`CORE_RULEBOOK`,
`ADVENTURE`, `ONE_SHOT`, `CAMPAIGN`, etc.) — não precisa de mudança
adicional de schema para isso no futuro, só popular o enum conforme o
produto evoluir.
