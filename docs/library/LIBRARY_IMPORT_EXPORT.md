# Import/Export da Biblioteca (LIB-007)

## Dois conceitos separados — nunca confundir

### A) CSV operacional (catálogo e campanhas)

`POST /api/v1/import/preview` + `/import/confirm` (catálogo),
`/import/campaigns/preview` + `/import/campaigns/confirm` (campanhas), e
`GET /api/v1/export?format=csv` (só catálogo, não campanhas).

Formato simples, colunas em português, pensado para uma planilha
preparada manualmente pelo usuário (ou por uma ferramenta externa que
gere esse formato) — **não** é um backup completo: não carrega
`archived_at`, `coverAssetId`, provenance/external IDs, grupos por ID
(só texto legado), nem qualquer outra tabela do produto (Worlds, Vault,
etc.).

**Limitação conhecida e documentada (não corrigida nesta tarefa):** o
CSV gerado por `GET /export?format=csv` usa cabeçalhos em inglês
(`title`, `category`, `subgenre`, `reading_status`, ...) — um esquema
**diferente** do que `/import/preview` exige (`Sistema / Jogo`,
`Categoria`, `Subgênero`, `Status da leitura`, ...). Não existe hoje
round-trip automático "exportar catálogo CSV → reimportar". O texto da
UI que sugeria isso ("CSV exportado da aba Catálogo de Livros") foi
corrigido para descrever o formato realmente aceito, em vez de prometer
um round-trip inexistente. Unificar os dois esquemas é uma decisão de
produto separada, fora de escopo do LIB-007.

### B) Backup completo (JSON estruturado) — F-015, `schemaVersion: 8`

`GET /api/v1/export` (sem `?format=csv`, o padrão). Cobertura **completa**
de todo dado autoral do usuário: `rpgs`/`publications`/`game_systems`/
`publication_external_ids`/`publication_aliases`, campanhas/sessões/
membros/presença, grupos, Worlds (+ `world_members`/`world_tags`/
`world_eras`/`world_calendars`), Vault (`vault_entities` + TODOS os
campos especializados — `adventure_details`, `lore_details`,
`character_details`, `npc_details`, `creature_details`,
`creature_stat_blocks`, `creature_stat_templates`, `faction_details`,
`item_details`, `event_temporal_details`), Journal (`journal_folders`,
`journal_pages`), Wiki (`wiki_folders`, `wiki_entity_metadata`,
`wiki_entity_tags`, `wiki_entity_aliases`), Relations
(`entity_relations`), Cartografia (`world_maps`, `map_pins`), External
Resources, e Revision History (`entity_revisions`, F-001). O campo
top-level mudou de `version` para `schemaVersion` (v7 → v8) — ver
`src/domain/backup/types.ts`.

**Restore automatizado (F-015, RPG-1.0-BATCH6):** `POST
/api/v1/import/backup/preview` (dry-run — valida tudo, remapeia
referências, nunca grava) + `POST /api/v1/import/backup/confirm`
(executa o plano já validado). Decisões de arquitetura completas em
`src/server/routes/backup-restore.ts` e
`docs/product/RPG_MANAGER_FINAL_STATUS.md` (seção F-015) — resumo:
restore **sempre cria registros novos** (IDs gerados no servidor, nunca
sobrescreve nada por ID — elimina o vetor de IDOR mais óbvio e o risco
de destruir dado real), toda linha reconstruída é revalidada pelos
MESMOS schemas Zod do create normal, e `owner_user_id`/`user_id` do
JSON enviado é sempre ignorado — o dono do dado restaurado é sempre
quem está autenticado. **Escopo v1 do restore automatizado:** Worlds,
Creature Stat Templates, Vault entities (+ especializados), Journal
(pastas+páginas). Groups/Campaigns/Library, Wiki (organização),
Relations, Cartografia, External Resources e Revision History
continuam cobertos pelo EXPORT (nada é perdido no backup), mas ainda
não têm restore automatizado — limitação documentada, não escondida,
próxima iteração natural do F-015.

## Semântica do preview de import de catálogo

Cada linha do CSV recebe exatamente uma classificação — nunca ambíguo:

| Classificação | Significado | Aprovável no confirm? |
|---|---|---|
| `NOVO` | Título/ISBN não existem em lugar nenhum — cria Game System + Publication + entry | Sim |
| `ATUALIZACAO` | RPG já existe (por título) e ainda não tem capa própria — só a capa é atualizada | Sim |
| `EXISTING_PUBLICATION` | Publication já existe no catálogo global (por ISBN), usuário ainda não a possui — reaproveita, cria só a entry | Sim |
| `ALREADY_IN_LIBRARY` | Usuário já possui essa Publication, entry **ativa** | Não — informativo, com link para a entry |
| `ARCHIVED_IN_LIBRARY` | Usuário já possui essa Publication, entry **arquivada** (LIB-006) | Não — informativo, com link para restaurar |
| `IGNORADO` | RPG já existe e já tem capa, ou CSV não fornece capa | Não — nada a fazer |
| `ERRO` | Campos inválidos, ISBN inválido, capa insegura, título repetido no CSV, **ISBN repetido no CSV** (LIB-007) | Não |

Backend e frontend usam exatamente a mesma lista (`transfer.ts` server-side,
`settings-pages.tsx` client-side) — nenhum nome inventado.

## Bug real encontrado e corrigido (LIB-007)

`EXISTING_PUBLICATION` já era processável pelo backend desde LIB-003
(`/import/confirm` sempre aceitou essa classificação, e
`tests/integration/publication-identity.test.ts` já provava isso), mas
a UI de preview (`settings-pages.tsx`) nunca marcava essa linha como
`actionable`: o checkbox ficava sempre desabilitado e a linha nunca era
pré-selecionada — usuário não conseguia importar um título que já existe
no catálogo global, mesmo sem duplicar nada.

Reproduzido pela primeira vez com um teste E2E real
(`tests/e2e/library-import-existing-publication.spec.ts` — nenhum teste
E2E de import CSV existia antes desta tarefa), confirmado falhando no
código anterior (checkbox `disabled`), corrigido incluindo
`EXISTING_PUBLICATION` nas duas checagens client-side
(`actionable` e a pré-seleção automática) — mesmo critério de segurança/
aditividade já aplicado a `NOVO`/`ATUALIZACAO`.

## ISBN duplicado dentro do mesmo arquivo (LIB-007)

Se o CSV contém a mesma identidade de ISBN em duas ou mais linhas e
nenhuma delas já existe no catálogo, cada linha resolveria
independentemente como `NOVO`. Se ambas fossem aprovadas no mesmo
`/import/confirm`, o batch tentaria inserir a mesma `publications.isbn13`
duas vezes na mesma transação — violando o índice único
(`idx_publications_isbn13_unique`) e revertendo o lote inteiro, inclusive
linhas que seriam válidas sozinhas.

Corrigido no preview: toda linha cujo ISBN aparece mais de uma vez no
mesmo arquivo é classificada `ERRO` ("ISBN repetido no CSV; revisão
manual necessária."), mesmo padrão já usado para título repetido
(`titleCounts`) — nunca usa fuzzy title para identidade, só o ISBN
classificado (`classifyIsbn`). Testado explicitamente.

Como defesa em profundidade (uma corrida real — duas abas confirmando
prévias sobrepostas — ainda poderia, em teoria, colidir), `/import/confirm`
agora também captura uma eventual violação do índice único de ISBN e
devolve `409 DUPLICATE_ISBN` com mensagem clara, em vez de um `500`
genérico — mesmo tratamento já usado em `POST /rpgs`.

## Atomicidade do confirm

`/import/confirm` é **atomic total**: todas as linhas aprovadas viram um
único `c.env.DB.batch()` (transação implícita do D1) — se qualquer
statement falhar, o lote inteiro é revertido, nunca processamento
parcial. Esse já era o comportamento antes desta tarefa; não foi
alterado, só documentado e reforçado com tratamento de erro claro.

## Multi-tenant / segurança

- Um import job (`import_jobs`) só pode ser confirmado pelo mesmo
  usuário que gerou o preview (`WHERE id=? AND user_id=?`) — testado
  explicitamente (`404` para outra conta).
- Reaproveitar uma Publication (`EXISTING_PUBLICATION`) nunca copia
  estado pessoal de quem já a possui (`notes`, `wantsToPlay`, etc.) —
  testado explicitamente.
- ISBN inválido, capa insegura (SSRF/protocolo perigoso) e ownership
  continuam validados como no cadastro manual — nenhuma via paralela.

## Formula injection no CSV export (LIB-007)

`GET /export?format=csv` neutraliza qualquer campo que comece com
`=`, `+`, `-` ou `@` prefixando um apóstrofo (`'`) — mitigação
recomendada pela OWASP para CWE-1236 (Spreadsheet Formula Injection).
Sem isso, um `title`/`notes` salvo pelo próprio usuário começando com
`=cmd|'/c calc'!A1` (ou equivalente) executaria como fórmula ao abrir o
CSV no Excel/Sheets. Testado explicitamente.

## Limites (Zero Cost — Workers/D1 Free)

Já existentes antes desta tarefa, auditados e considerados adequados
(nenhuma mudança):

- CSV de entrada: até 500 KB (`previewSchema`).
- Linhas de dados por arquivo: até 40 (`IMPORT_BATCH_LIMIT`) — limite
  transacional do plano gratuito (um `batch()` grande demais arrisca
  timeout/memória do Worker Free).
- Linhas aprovadas por confirm: até 40 (`catalogConfirmSchema`).
- Preview expira em 30 minutos (`import_jobs.expires_at`) — identidade
  sempre reresolvida ao vivo no confirm, nunca confia num
  `resolvedPublicationId` velho.
- Restore de backup (F-015): até 200 Worlds e 1000 entidades do Vault/
  1000 páginas de Diário por operação (`backup_restore_jobs`, mesma
  janela de 30 minutos). Acima disso, `422 BACKUP_TOO_LARGE` — limite
  deliberado para o batch de escrita continuar dentro do orçamento
  seguro do D1 Free.

## Cobertura do backup completo (JSON)

O que **é** recuperável a partir do backup completo: identidade de
Publication/Game System (título, ISBN10/13, autores, editora, ano,
idioma, tipo, `cover_url`, provenance), toda User Library Entry
(incluindo `archived_at` — LIB-006), campanhas/sessões/membros/presença,
grupos e membros, Worlds/Vault/preferências, `publication_external_ids`.

O que **depende do KV atual** (não é bytes portáveis dentro do JSON):
`publications.cover_asset_id` é só uma **referência** (UUID) para um
objeto no Workers KV (`COVERS_KV`, ver `docs/library/COVER_STORAGE.md`).
O backup guarda essa referência, não os bytes da imagem — restaurar o
backup em outra conta/ambiente sem o MESMO KV populado resulta numa
referência que não resolve (`GET /api/v1/media/covers/:id` devolve
`404 NOT_FOUND`, o mesmo comportamento honesto de "capa não encontrada"
já usado para qualquer asset ausente, nunca um erro genérico ou dado
inventado). Deliberadamente **não implementado** nesta tarefa: download
em massa dos bytes do KV para dentro do JSON — mudaria o formato/tamanho
do backup significativamente (imagens em base64 dentro de um JSON de
metadados) sem uma necessidade de arquitetura explícita; ver seção 11 do
pedido LIB-007. Testado explicitamente que o backup preserva a
referência correta (`cover_asset_id` == o UUID do asset real no KV).

## Testes

- `tests/integration/library-import-export.test.ts`: ISBN duplicado no
  CSV, export CSV neutraliza formula injection, IDOR em import job,
  isolamento de estado pessoal ao reaproveitar Publication, round-trip
  do backup completo (Publication identity + `archived_at` +
  `cover_url` + `cover_asset_id`).
- `tests/e2e/library-import-existing-publication.spec.ts`: reprodução
  real do bug de `EXISTING_PUBLICATION` (desktop + mobile).
- Cobertura pré-existente mantida e revalidada: BOM UTF-8 no início do
  CSV (`String.prototype.trim()` já remove — ECMAScript trata `U+FEFF`
  como WhiteSpace — confirmado com teste, nenhuma mudança necessária),
  aspas/vírgulas em campos (`parseCsv`), capa insegura, capa legada
  preservada, dedup por título e por ISBN.
