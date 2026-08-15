// LIB-002: camada canônica de escrita do domínio Game System + Publication +
// User Library Entry, compartilhada entre o cadastro/edição manual (rpgs.ts) e o
// import CSV (transfer.ts) — ver docs/library/LIBRARY_ARCHITECTURE.md. Único
// lugar que sabe como as 3 tabelas se relacionam; nenhuma outra rota deve montar
// esses INSERTs/UPDATEs por conta própria (seção 18 do pedido: "não manter um
// caminho paralelo incompatível").
import { DEFAULT_PUBLICATION_TYPE, normalizeLibraryName } from '../../domain/rpg/library-domain';
import type { RpgInput } from '../../shared/validation/schemas';
import { cleanNullable } from '../http';

export interface LibraryEntryIds { entryId: string; gameSystemId: string; publicationId: string }

// Sem reuso/dedup entre criações nesta versão: cada RPG cadastrado (manual ou
// importado) ganha seu próprio Game System + Publication, mesmo que o título
// já exista em outra Publication do mesmo usuário ou de outro. Decisão
// deliberada — ver LIBRARY_ARCHITECTURE.md ("Escopo de criação do LIB-002") —
// não introduzir superfície de edição cruzada entre contas nem merge automático
// (seção 15 do pedido) antes de um desenho de compartilhamento com revisão de
// segurança dedicada. `UNIQUE(user_id, title)` em `rpgs` continua sendo a única
// defesa contra duplicata, como antes desta migration.
export function buildCreateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; now: string },
): { statements: D1PreparedStatement[]; ids: LibraryEntryIds } {
  const { entryId, userId, input, now } = params;
  const gameSystemId = `gs_${crypto.randomUUID()}`;
  const publicationId = `pub_${crypto.randomUUID()}`;
  const statements = [
    db.prepare('INSERT INTO game_systems (id,name,normalized_name,publisher,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(gameSystemId, input.title, normalizeLibraryName(input.title), '', '', now, now),
    db.prepare(`INSERT INTO publications (id,game_system_id,publication_type,title,subtitle,edition,publisher,publication_year,language,isbn,isbn10,isbn13,description,cover_url,cover_source_url,cover_source_note,metadata_source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(publicationId, gameSystemId, DEFAULT_PUBLICATION_TYPE, input.title, '', '', '', null, '', cleanNullable(input.isbn), null, null, '', cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), 'MANUAL', now, now),
    db.prepare(`INSERT INTO rpgs (id,user_id,title,category_id,subgenre_id,reading_status,has_played,wants_to_play,priority,play_group_notes,play_group_id,planned_play_date,table_status,game_master,notes,cover_url,isbn,cover_source_url,cover_source_note,publication_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(entryId, userId, input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
        input.playGroupNotes, cleanNullable(input.playGroupId), cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, cleanNullable(input.coverUrl), cleanNullable(input.isbn),
        cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), publicationId, now, now),
  ];
  return { statements, ids: { entryId, gameSystemId, publicationId } };
}

// Atualiza as 3 tabelas na mesma transação (db.batch): metadata editorial vai para
// `publications`/`game_systems`, estado pessoal vai para `rpgs` (seção 13 do
// pedido). `publicationId` já deve ter sido resolvido pelo chamador (lookup em
// `rpgs.publication_id`) — sempre presente após esta migration (create sempre
// cria uma Publication; o backfill garante isso para linhas pré-existentes).
export function buildUpdateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; publicationId: string; input: RpgInput; now: string },
): D1PreparedStatement[] {
  const { entryId, userId, publicationId, input, now } = params;
  return [
    db.prepare('UPDATE publications SET title=?,isbn=?,cover_url=?,cover_source_url=?,cover_source_note=?,updated_at=? WHERE id=?')
      .bind(input.title, cleanNullable(input.isbn), cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), now, publicationId),
    db.prepare('UPDATE game_systems SET name=?,normalized_name=?,updated_at=? WHERE id=(SELECT game_system_id FROM publications WHERE id=?)')
      .bind(input.title, normalizeLibraryName(input.title), now, publicationId),
    db.prepare(`UPDATE rpgs SET title=?,category_id=?,subgenre_id=?,reading_status=?,has_played=?,wants_to_play=?,priority=?,
      play_group_notes=?,play_group_id=?,planned_play_date=?,table_status=?,game_master=?,notes=?,updated_at=? WHERE id=? AND user_id=?`)
      .bind(input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
        input.playGroupNotes, cleanNullable(input.playGroupId), cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, now, entryId, userId),
  ];
}

// JOIN canônico de leitura: toda rota que precisa dos campos editoriais
// (title/coverUrl/isbn/coverSourceUrl/coverSourceNote) de um User Library Entry
// usa esta mesma junção — `publications` é a fonte de verdade para esses campos
// desde esta migration, não mais as colunas legadas homônimas em `rpgs`
// (mantidas fisicamente por segurança de rollback, mas não lidas pelo app).
export const LIBRARY_ENTRY_JOIN = 'LEFT JOIN publications p ON p.id=r.publication_id';
