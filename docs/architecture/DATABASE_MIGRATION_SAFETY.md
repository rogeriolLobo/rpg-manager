# RPG MANAGER — SEGURANÇA DE MIGRATIONS D1/SQLite

Este documento formaliza uma regra de engenharia extraída de um incidente real
em produção (LIB-004B). Aplica-se a qualquer migration futura que precise
recriar (`DROP TABLE` + `CREATE TABLE`) uma tabela referenciada por foreign
keys de outras tabelas — o caso clássico é mudar uma `CHECK` constraint, que o
SQLite não permite alterar via `ALTER TABLE`.

## O incidente (LIB-004B)

A migration `0020_publication_metadata_source_open.sql` precisava relaxar uma
`CHECK` constraint da tabela `publications`. Como SQLite não suporta
`ALTER TABLE ... ALTER COLUMN` para mudar constraints, a migration usou a
técnica oficialmente recomendada pelo próprio SQLite: `DROP TABLE` +
`CREATE TABLE` (com a nova constraint) + `INSERT ... SELECT` para restaurar os
dados.

A migration incluía `PRAGMA foreign_keys = OFF;` antes do `DROP TABLE`,
esperando suprimir os efeitos de FK durante a operação — prática comum em
SQLite "puro". **Isso não funciona no D1**: cada arquivo de migration roda
dentro de uma transação implícita do D1, e `PRAGMA foreign_keys` é
efetivamente um no-op dentro dela. O `DROP TABLE publications` disparou a ação
`ON DELETE SET NULL` de toda FK que apontava para `publications.id` — no caso,
`rpgs.publication_id` — **antes** da tabela ser recriada. Resultado: as 30
linhas de produção tiveram `rpgs.publication_id` zerado, mesmo `publications`
sendo recriada corretamente, com os mesmos dados, milissegundos depois.

O bug nunca reproduziu localmente nem no CI porque essas execuções sempre
migram um banco vazio (sem linhas em `rpgs` para uma FK "zerar"). Só
apareceu em produção, com dados reais. Corrigido via
`0021_repair_rpgs_publication_link.sql` (reparo idempotente, usando o padrão
determinístico de ID `pub_<rpg.id>` do backfill original do LIB-002).

## A regra

Antes de fazer `DROP TABLE` de qualquer tabela **referenciada por FK** de
outra tabela, dentro da mesma migration:

1. **Não confie em `PRAGMA foreign_keys = OFF`** para proteger dados de
   tabelas filhas — no D1, é um no-op dentro da transação implícita da
   migration.
2. **Não use `CREATE TEMP TABLE`** para backup — o D1 rejeita com
   `SQLITE_AUTH`. Use uma tabela normal, removida ao final da mesma
   migration.
3. Faça backup dos valores de FK das tabelas filhas **antes** do `DROP TABLE`
   da tabela pai:
   ```sql
   CREATE TABLE _fk_backup (id TEXT PRIMARY KEY, parent_id TEXT);
   INSERT INTO _fk_backup SELECT id, parent_id FROM tabela_filha WHERE parent_id IS NOT NULL;
   ```
4. Faça o `DROP TABLE` / `CREATE TABLE` (com a nova constraint) / `INSERT ...
   SELECT` de restauração de dados da tabela pai, normalmente.
5. Restaure os valores de FK nas tabelas filhas a partir do backup:
   ```sql
   UPDATE tabela_filha SET parent_id = (
     SELECT parent_id FROM _fk_backup WHERE _fk_backup.id = tabela_filha.id
   ) WHERE id IN (SELECT id FROM _fk_backup);
   ```
6. Remova a tabela de backup na mesma migration:
   ```sql
   DROP TABLE _fk_backup;
   ```
7. Escreva um teste de integração que popule a tabela filha **antes** de
   aplicar a migration em teste (replicando dados reais) — testes que só
   migram um banco vazio não detectam esta classe de bug (foi exatamente o
   que aconteceu aqui).

## Alternativa preferível: evitar o rebuild

Sempre que a mudança permitir, prefira uma migration puramente aditiva
(`ADD COLUMN` nullable, sem `CHECK`, sem `NOT NULL` sem `DEFAULT` simples) —
esse formato nunca exige `DROP TABLE`/rebuild no SQLite/D1, e portanto nunca
tem esse risco. É a abordagem usada, por exemplo, em
`0022_publication_cover_asset.sql` (LIB-005) — `cover_asset_id` foi
deliberadamente projetada sem `CHECK` constraint para nunca precisar deste
procedimento.

## Referência cruzada

- `CLAUDE.md`, seção 15 (Migrations).
- `docs/library/LIBRARY_ARCHITECTURE.md`, seção "LIB-004B — Regressão de
  capas na listagem da Biblioteca" (narrativa completa do incidente).
- `docs/release/RELEASE_CHAIN_POLICY.md`.
