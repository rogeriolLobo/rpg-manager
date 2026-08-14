# Biblioteca — Estado Atual (Auditoria LIB-001)

Data: 2026-08-14. Auditoria de código real (não de memória/relatórios
anteriores).

## Modelo atual

Uma única tabela `rpgs` (migration `0001_initial_schema.sql`, colunas
de capa adicionadas em `0008_rpg_cover_metadata.sql`) mistura três
responsabilidades conceitualmente distintas:

1. **Identidade do sistema de jogo** — `title`, `category_id`,
   `subgenre_id`.
2. **Metadata editorial** — `cover_url`, `isbn`, `cover_source_url`,
   `cover_source_note`.
3. **Estado pessoal do usuário** — `reading_status`, `has_played`,
   `wants_to_play`, `priority`, `play_group_notes`, `play_group_id`,
   `planned_play_date`, `table_status`, `game_master`, `notes`.

```sql
CREATE TABLE rpgs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  category_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  subgenre_id TEXT REFERENCES subgenres(id) ON DELETE RESTRICT,
  reading_status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(...),
  has_played INTEGER NOT NULL DEFAULT 0,
  wants_to_play INTEGER NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'NONE' CHECK(...),
  play_group_notes TEXT NOT NULL DEFAULT '',
  planned_play_date TEXT,
  table_status TEXT NOT NULL DEFAULT 'IDEA' CHECK(...),
  game_master TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  cover_url TEXT,               -- 0008
  isbn TEXT,                    -- 0008
  cover_source_url TEXT,        -- 0008
  cover_source_note TEXT,       -- 0008
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, title)
);
```

Não existe hoje: `game_system_id`, `publication_type`, `edition`,
`publisher`, `publication_year`, `language`, `isbn10`/`isbn13`
separados, `authors`, `metadata_source`/`metadata_source_id`/
`metadata_fetched_at`, cover binário/upload, tabela de duplicatas.

`UNIQUE(user_id, title)` é a única defesa contra duplicata hoje — por
**título exato**, não por ISBN. Título sozinho não é uma chave segura
(seção 22 do pedido) — isso é dívida real.

## Responsabilidades das tabelas envolvidas

- `categories`/`subgenres`: taxonomia fixa, seedada (`0002_seed_categories.sql`),
  RESTRICT em delete — não editável pelo usuário hoje.
- `play_groups`/`play_group_members`: grupo de jogo, referenciado por
  `rpgs.play_group_id` (nullable) — não é dado da publicação.
- `import_jobs`: staging de preview de importação CSV (payload_hash +
  normalized_payload, expira em 30min).

## Create flow

`POST /rpgs` (`src/server/routes/rpgs.ts`): valida taxonomia (categoria/
subgênero), valida grupo de jogo, insere via schema único
(`rpgInputSchema`, `src/shared/validation/schemas.ts`) que mistura os
três domínios (título+capa+estado pessoal) num único payload
obrigatório. `UNIQUE(user_id, title)` retorna 409 em duplicata exata de
título.

## Read flow

`GET /rpgs` (paginado, filtros por categoria/subgênero/status/prioridade/
mesa, busca por título com `LIKE` escapado) e `GET /rpgs/:id` (com
campanhas vinculadas). `present()` calcula campos derivados
(`recommendationScore`, `readiness`, `nextAction`) a partir do domínio
`src/domain/rpg/recommendation.ts` — lógica de recomendação já
separada do modelo de dados, boa prática existente.

## Update flow

`PATCH /rpgs/:id` — **PUT semântico**: exige o payload completo (não
parcial), reescreve todos os campos. Este era o núcleo do incidente
`RPG_EDIT_INVALID_DATA` (ver `docs/bugs/RPG_EDIT_INVALID_DATA.md` e
`docs/release/PRODUCTION_DEPLOY_INCIDENT.md`) — corrigido nesta sessão
na parte de `coverUrl` (política agora puramente sintática, igual para
CREATE/PATCH/import, sem allowlist de hosts nem fetch do servidor).

## Archive/delete flow

Não existe archive para RPG (existe para Vault Entities e Worlds, mas
não para `rpgs`). `DELETE /rpgs/:id` é exclusão física, bloqueada por
FK se houver campanhas vinculadas (`409 RPG_HAS_CAMPAIGNS`).

## Import flow

`POST /import/preview` + `/import/confirm` (`src/server/routes/transfer.ts`):
CSV → normalização → dedup por **título normalizado** (`normalizeTitle`,
NFKC + lowercase pt-BR) — mesma limitação de "título não é chave segura".
Capas: `IGNORADO` se o RPG já tem capa própria (preserva), `ATUALIZACAO`
se não tem. Após esta sessão, usa a mesma validação sintática de
`coverUrl` do create/edit (sem regra divergente).

## Cover flow

Antes desta sessão: `coverUrl` exigia host allowlist fixo
(`COVER_IMAGE_HOSTS`) **e** um fetch do servidor verificando
Content-Type real (`validateRemoteCoverImage`), tanto no create quanto
(condicionalmente) no edit. Isso não escalava para hosts fora da
allowlist (causa raiz do incidente Devir) e duplicava a política de CSP
`img-src` sem garantia de sincronia entre as duas allowlists.

Depois: `coverUrl` é só uma URL HTTPS pública validada sintaticamente
(sem allowlist, sem fetch do servidor) — o navegador carrega `<img>`
diretamente, com fallback (`onError`) já implementado no frontend
(`CoverImage` em `library-pages.tsx`) mostrando um placeholder com
iniciais quando a imagem falha, sem loop de requisição.

Não existe hoje: upload de arquivo, storage binário (KV/R2), busca de
metadata externa (Open Library/Google Books), preview antes de salvar,
provenance de metadata.

## Validação

Schema único `rpgInputSchema` (Zod, `strictObject`) mistura os três
domínios. Erros de campo (`fields`) agora chegam ao frontend para
`coverUrl`/`title`/`isbn`/`coverSourceUrl`/`coverSourceNote`/
`plannedPlayDate` (trabalho desta sessão, incidente anterior).

## Testes (evidência real, contada)

- `tests/unit/validation.test.ts`, `cover-security.test.ts`: schema e
  URL de capa.
- `tests/integration/auth-and-isolation.test.ts`: create/edit/isolamento/
  IDOR/mass-assignment/rate-limit/convites, incluindo o novo teste de
  política de `coverUrl`.
- `tests/e2e/core-flow.spec.ts`, `rpg-cover-edit.spec.ts`: fluxo completo
  pela UI real, incluindo os 5 cenários DoD do incidente de capa.
- Nenhum teste cobre hoje: upload de imagem, metadata provider, dedup
  por ISBN, archive de RPG — porque essas features não existem.

## Problemas encontrados / dívida arquitetural

1. **Modelo misto** (Game System + Publication + estado pessoal numa
   tabela só) — funciona para o volume atual, mas não representa
   "System → Publications" nem suporta múltiplos usuários com o mesmo
   RPG na biblioteca sem duplicar metadata editorial.
2. **Dedup por título, não por ISBN** — falso-negativo (duas edições
   diferentes com título igual colidem) e falso-positivo silencioso
   (grafias diferentes do mesmo livro não são detectadas).
3. **PATCH é PUT semântico** — funcional, mas exige o cliente reenviar
   o objeto inteiro; combinado com um formulário mal cuidado (como no
   incidente anterior), aumenta a superfície de bugs de "campo que eu
   não editei mudou sozinho".
4. **Sem archive** para RPG (existe em Worlds/Vault) — delete é a única
   opção reversível apenas via FK-bloqueio (indireto, não é archive de
   verdade).
5. **Sem upload de capa** — depende inteiramente de URL externa.
6. **Sem metadata provider** — cadastro é 100% manual.
7. **Sem provenance** — não há como saber se um campo foi preenchido
   manualmente ou importado de algum lugar.

Nenhum desses é `BROKEN` hoje — são gaps funcionais reais (`MISSING`),
não regressões. O único bug funcional real (`coverUrl` rejeitando URLs
HTTPS válidas) está corrigido e em produção.
