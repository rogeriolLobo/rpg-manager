# Archive/Restore da Biblioteca (LIB-006)

## Domínio

Desde LIB-002, `rpgs` representa a **User Library Entry** — a relação
pessoal de um usuário com uma Publication. Archive atua exclusivamente
sobre essa relação: `rpgs.archived_at` (coluna e índice
`(user_id, archived_at)` já existentes desde a migration 0016, nunca
usados até esta tarefa — nenhuma migration nova foi necessária).

Archive **nunca** toca em `publications`/`game_systems` (catálogo
compartilhado, sem dono). Uma Publication pode ter, ao mesmo tempo, uma
Library Entry ativa para o usuário A e arquivada para o usuário B — a
Publication em si é indiferente a isso.

## Semântica

- `archive`: `rpgs.archived_at = now()`.
- `restore`: `rpgs.archived_at = NULL`.
- Nunca um `DELETE`. 100% dos dados preservados: `publication_id`,
  `coverUrl` (externa), `coverAssetId` (upload, LIB-005), ISBN, estado
  pessoal (leitura, prioridade, notas, grupo, narrador, data planejada),
  vínculos de campanha, `created_at`.
- IDs nunca mudam. Restaurar não cria uma linha nova — é o mesmo `rpgs.id`
  de sempre.

## Idempotência (endpoints)

```
POST /api/v1/rpgs/:id/archive
POST /api/v1/rpgs/:id/restore
```

Implementados como um único `UPDATE ... WHERE id=? AND user_id=?`.
`meta.changes` (linhas afetadas pelo `WHERE`) prova posse+existência
independentemente do valor anterior de `archived_at` — arquivar um item
já arquivado, ou restaurar um já ativo, sempre retorna `200` com o estado
final correto, nunca erro. Um `id` inexistente ou de outra conta retorna
`404` (mesmo padrão de IDOR do resto do app — nunca distingue "não
existe" de "não autorizado").

## Onde "ativo" é o padrão (e onde não é)

`GET /rpgs` (Biblioteca): `archived_at IS NULL` por padrão;
`?archived=true` inverte para mostrar só arquivados. Nunca mistura os
dois numa mesma resposta.

`GET /rpgs/:id` (detalhe): **nunca** filtra por `archived_at` — abrir a
URL de um item arquivado sempre funciona (`200`), com o campo
`archivedAt` indicando o estado para a UI mostrar "Arquivado" +
"Restaurar".

Dashboard (métricas, recomendações, "o que jogar agora", backlog de
leitura) e a contagem de RPGs por grupo (`GET /groups`) passam a excluir
arquivados — um RPG arquivado não deve aparecer como recomendação nem
inflar contadores.

`campaigns` **nunca** filtra por `archived_at` do RPG vinculado — uma
Campaign continua carregando normalmente mesmo se o RPG dela for
arquivado depois. A API expõe `rpgArchived: boolean` para a UI mostrar um
indicador ("· RPG arquivado") sem esconder nada. O formulário de edição
de Campaign também garante que o RPG já vinculado apareça na lista de
opções mesmo se estiver arquivado (senão o `<select>` ficaria com um
valor "órfão").

Busca global (Command Palette, `search.ts`) **não** foi alterada — RPGs
arquivados continuam aparecendo na busca geral, para que o usuário
consiga localizar e restaurar um item arquivado através dela. Decisão
deliberada, não omissão.

## Dedup entende arquivado

`src/domain/rpg/library-entry-state.ts` define o estado puro:
`NOT_IN_LIBRARY | ACTIVE_IN_LIBRARY | ARCHIVED_IN_LIBRARY`.

- **CREATE** (`buildCreateLibraryEntryStatements`): se a Publication
  resolvida (por `reusePublicationId`/external ID/ISBN) já é uma entry do
  usuário, `ACTIVE_IN_LIBRARY` continua devolvendo `409 ALREADY_IN_LIBRARY`
  (comportamento LIB-003, inalterado); `ARCHIVED_IN_LIBRARY` devolve
  `409 ARCHIVED_IN_LIBRARY` com `fields.libraryEntryId` (o ID existente,
  para a UI oferecer "Restaurar" em vez de duplicar).
- **Busca externa** (`/rpgs/search-external`): cada resultado com
  `internalPublicationId` (candidato já conhecido pelo catálogo) é
  anotado com `libraryStatus`/`libraryEntryId` quando corresponde a uma
  entry do usuário atual — a UI mostra "Já na sua Biblioteca" (com link)
  ou "Arquivado na sua Biblioteca" (com botão Restaurar) em vez de deixar
  "Selecionar" terminar num 409 sem explicação.
- **Import CSV** (`transfer.ts`): mesma resolução canônica — tanto pelo
  caminho de ISBN quanto pelo legado por título — classifica
  `ARCHIVED_IN_LIBRARY` (nunca aprovável no `/import/confirm`, mesma regra
  de `ALREADY_IN_LIBRARY`), com `existingId` para a UI linkar.

## SHARED_PUBLICATION_METADATA_LOCKED continua contando arquivadas

Uma Library Entry arquivada **conta como referência existente** para a
trava de metadata compartilhada (LIB-003). Se o usuário A arquiva sua
entry mas o usuário B continua com uma entry ativa para a mesma
Publication, B continua bloqueado para editar título/capa/ISBN/etc. —
porque se B pudesse editar livremente, A veria os dados trocados ao
restaurar, sem nunca ter concordado. `assertSharedPublicationEditable`
(`library-writes.ts`) não fez nenhuma distinção nova aqui — o
`COUNT(*) FROM rpgs WHERE publication_id=?` já contava arquivadas por
natureza (não tem `WHERE archived_at IS NULL`); esta tarefa só testou
esse comportamento explicitamente.

## Cover assets (LIB-005) sobrevivem intactos

Archive/restore nunca tocam em `publications.cover_asset_id`, `cover_url`
nem no KV — nenhum "orphan cleanup" acontece. Testado explicitamente:
upload → archive → restore → o mesmo `coverAssetId` continua servindo os
mesmos bytes via `GET /media/covers/:id`.

## Archive com Campaign ativa

Decisão (opção A, preserva dados e surpreende menos): **archive é sempre
permitido**, mesmo com Campaigns ativas vinculadas. Nunca há cascade
delete nem bloqueio. A confirmação na UI avisa quantas campanhas estão
vinculadas e explica que elas continuam funcionando normalmente. A
Campaign passa a mostrar "RPG arquivado" como indicador visual (ver
acima).

Rejeitada a opção B (bloquear archive com Campaign ativa) por ser mais
restritiva sem necessidade técnica real — a FK (`campaigns.rpg_id
REFERENCES rpgs(id) ON DELETE RESTRICT`) nem chega a ser relevante aqui,
porque archive nunca é `DELETE`; a linha de `rpgs` continua existindo,
então a Campaign nunca perde a referência.

## Hard delete

`DELETE /api/v1/rpgs/:id` continua existindo por compatibilidade (não foi
removido), mas **não é mais chamado por nenhuma ação normal da UI** — o
botão "Excluir RPG" na página de detalhe foi substituído por
"Arquivar RPG"/"Restaurar RPG". Nenhuma nova interface de "excluir
permanentemente" foi criada nesta tarefa.

Uma decisão futura de reintroduzir exclusão permanente na UI precisa
analisar, separadamente: Campaigns vinculadas (hoje `ON DELETE RESTRICT`
bloqueia), Publications compartilhadas, o asset no KV (LIB-005), e
qualquer necessidade de auditoria/histórico — fora de escopo do LIB-006.

## Export/backup

`GET /export?format=json` já fazia `SELECT * FROM rpgs WHERE user_id=?`
— `archived_at` sempre esteve incluído estruturalmente; esta tarefa
adicionou um teste explícito confirmando que o backup completo preserva
o estado arquivado (o usuário nunca perde a informação de que um item
estava arquivado, mesmo num backup/restore completo).
