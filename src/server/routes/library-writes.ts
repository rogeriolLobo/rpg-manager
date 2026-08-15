// LIB-002/LIB-003: camada canônica de escrita do domínio Game System +
// Publication + User Library Entry, compartilhada entre o cadastro/edição
// manual (rpgs.ts) e o import CSV (transfer.ts) — ver
// docs/library/LIBRARY_ARCHITECTURE.md e docs/library/PUBLICATION_IDENTITY.md.
// Único lugar que sabe como as 3+1 tabelas se relacionam; nenhuma outra rota
// deve montar esses INSERTs/UPDATEs por conta própria (seção 18 do pedido
// LIB-002: "não manter um caminho paralelo incompatível").
import { classifyIsbn, type ClassifiedIsbn } from '../../domain/rpg/isbn';
import { DEFAULT_PUBLICATION_TYPE, normalizeLibraryName } from '../../domain/rpg/library-domain';
import type { RpgInput } from '../../shared/validation/schemas';
import { ApiError, cleanNullable } from '../http';

export interface LibraryEntryIds { entryId: string; gameSystemId: string; publicationId: string }

interface ExistingPublicationRow {
  id: string; game_system_id: string; title: string; isbn: string | null;
  cover_url: string | null; cover_source_url: string | null; cover_source_note: string | null;
}

function buildRpgInsertStatement(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; publicationId: string; now: string },
): D1PreparedStatement {
  const { entryId, userId, input, publicationId, now } = params;
  return db.prepare(`INSERT INTO rpgs (id,user_id,title,category_id,subgenre_id,reading_status,has_played,wants_to_play,priority,play_group_notes,play_group_id,planned_play_date,table_status,game_master,notes,cover_url,isbn,cover_source_url,cover_source_note,publication_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(entryId, userId, input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
      input.playGroupNotes, cleanNullable(input.playGroupId), cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, cleanNullable(input.coverUrl), cleanNullable(input.isbn),
      cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), publicationId, now, now);
}

async function findPublicationByIsbn13(db: D1Database, isbn13: string): Promise<ExistingPublicationRow | null> {
  return db.prepare('SELECT id,game_system_id,title,isbn,cover_url,cover_source_url,cover_source_note FROM publications WHERE isbn13=?')
    .bind(isbn13).first<ExistingPublicationRow>();
}

async function findLibraryEntryForPublication(db: D1Database, userId: string, publicationId: string): Promise<{ id: string } | null> {
  return db.prepare('SELECT id FROM rpgs WHERE user_id=? AND publication_id=?').bind(userId, publicationId).first<{ id: string }>();
}

// Reexportado para o import CSV (transfer.ts) montar a mesma classificação de
// identidade linha a linha, sem duplicar a query — mesma camada canônica.
export interface PublicationByIsbn { id: string; title: string; cover_url: string | null }
export async function findPublicationsByIsbn13List(db: D1Database, isbn13List: string[]): Promise<Map<string, PublicationByIsbn>> {
  const unique = [...new Set(isbn13List)];
  if (!unique.length) return new Map();
  const rows = await db.prepare(`SELECT id,isbn13,title,cover_url FROM publications WHERE isbn13 IN (${unique.map(() => '?').join(',')})`)
    .bind(...unique).all<{ id: string; isbn13: string; title: string; cover_url: string | null }>();
  return new Map(rows.results.map((row) => [row.isbn13, { id: row.id, title: row.title, cover_url: row.cover_url }]));
}

// Cria só a User Library Entry, ligando a uma Publication já existente (dedup
// por ISBN, seção 9 do pedido LIB-003) — usado tanto pelo create manual (via
// buildCreateLibraryEntryStatements) quanto pelo import CSV (classificação
// EXISTING_PUBLICATION em transfer.ts). Nunca escreve em publications/
// game_systems — metadata compartilhada não é alterada por um reuso.
export function buildLinkExistingPublicationStatement(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; publicationId: string; now: string },
): D1PreparedStatement {
  return buildRpgInsertStatement(db, params);
}

// LIB-003: identidade + dedup seguro. ISBN válido que já existe no catálogo
// (de qualquer conta — publications não têm dono, são catálogo compartilhado,
// mesmo modelo de categories/subgenres) reaproveita a Publication existente em
// vez de criar outra — só a nova User Library Entry é criada. Sem ISBN, ou
// ISBN sem correspondência: cria Game System + Publication novos, como antes
// (LIB-002). Nunca deduplica por título (não é identificador confiável).
export async function buildCreateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; now: string },
): Promise<{ statements: D1PreparedStatement[]; ids: LibraryEntryIds; reusedExistingPublication: boolean }> {
  const { entryId, userId, input, now } = params;
  const classified = classifyIsbn(input.isbn ?? null);

  if (classified) {
    const existing = await findPublicationByIsbn13(db, classified.isbn13!);
    if (existing) {
      const alreadyInLibrary = await findLibraryEntryForPublication(db, userId, existing.id);
      if (alreadyInLibrary) {
        throw new ApiError(409, 'ALREADY_IN_LIBRARY', 'Você já tem este título na sua biblioteca.');
      }
      const statements = [buildRpgInsertStatement(db, { entryId, userId, input, publicationId: existing.id, now })];
      return { statements, ids: { entryId, gameSystemId: existing.game_system_id, publicationId: existing.id }, reusedExistingPublication: true };
    }
  }

  const gameSystemId = `gs_${crypto.randomUUID()}`;
  const publicationId = `pub_${crypto.randomUUID()}`;
  const statements = [
    db.prepare('INSERT INTO game_systems (id,name,normalized_name,publisher,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(gameSystemId, input.title, normalizeLibraryName(input.title), '', '', now, now),
    db.prepare(`INSERT INTO publications (id,game_system_id,publication_type,title,subtitle,edition,publisher,publication_year,language,isbn,isbn10,isbn13,description,cover_url,cover_source_url,cover_source_note,metadata_source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(publicationId, gameSystemId, DEFAULT_PUBLICATION_TYPE, input.title, '', '', '', null, '', classified?.normalized ?? cleanNullable(input.isbn), classified?.isbn10 ?? null, classified?.isbn13 ?? null, '', cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), 'MANUAL', now, now),
    buildRpgInsertStatement(db, { entryId, userId, input, publicationId, now }),
  ];
  return { statements, ids: { entryId, gameSystemId, publicationId }, reusedExistingPublication: false };
}

const METADATA_FIELDS = ['title', 'isbn', 'coverUrl', 'coverSourceUrl', 'coverSourceNote'] as const;

// LIB-003: metadata editorial (título/ISBN/capa) só pode ser alterada enquanto
// a Publication tiver 1 única User Library Entry — ver
// docs/library/PUBLICATION_IDENTITY.md ("Política de segurança para metadata
// compartilhada"). Estado pessoal nunca é afetado por essa trava. ISBN
// inalterado em relação ao valor já persistido pula a validação de checksum
// (mesmo princípio do incidente de coverUrl — LIB-001, CLAUDE.md seção 18):
// nunca torna um registro legado impossível de salvar por causa de um campo
// que a pessoa nem tocou.
export async function buildUpdateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; publicationId: string; input: RpgInput; now: string },
): Promise<D1PreparedStatement[]> {
  const { entryId, userId, publicationId, input, now } = params;
  const publication = await db.prepare('SELECT id,game_system_id,title,isbn,cover_url,cover_source_url,cover_source_note FROM publications WHERE id=?')
    .bind(publicationId).first<ExistingPublicationRow>();
  if (!publication) {
    // Defensivo: não deveria acontecer (publication_id sempre resolvido no create/backfill).
    return [db.prepare(`UPDATE rpgs SET title=?,category_id=?,subgenre_id=?,reading_status=?,has_played=?,wants_to_play=?,priority=?,
      play_group_notes=?,play_group_id=?,planned_play_date=?,table_status=?,game_master=?,notes=?,updated_at=? WHERE id=? AND user_id=?`)
      .bind(input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
        input.playGroupNotes, cleanNullable(input.playGroupId), cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, now, entryId, userId)];
  }

  const incomingIsbnRaw = cleanNullable(input.isbn);
  const isbnUnchanged = incomingIsbnRaw === publication.isbn;
  let classified: ClassifiedIsbn | null = null;
  if (!isbnUnchanged) {
    classified = classifyIsbn(incomingIsbnRaw);
    if (incomingIsbnRaw && !classified) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Dados inválidos.', { isbn: ['ISBN inválido — confira os dígitos.'] });
    }
  }

  const metadataChanged = {
    title: input.title !== publication.title,
    isbn: !isbnUnchanged,
    coverUrl: cleanNullable(input.coverUrl) !== publication.cover_url,
    coverSourceUrl: cleanNullable(input.coverSourceUrl) !== publication.cover_source_url,
    coverSourceNote: cleanNullable(input.coverSourceNote) !== publication.cover_source_note,
  };
  const anyMetadataChanged = METADATA_FIELDS.some((field) => metadataChanged[field]);

  if (anyMetadataChanged) {
    const referenceCount = await db.prepare('SELECT COUNT(*) total FROM rpgs WHERE publication_id=?').bind(publicationId).first<{ total: number }>();
    if (Number(referenceCount?.total ?? 1) > 1) {
      const fields = Object.fromEntries(
        METADATA_FIELDS.filter((field) => metadataChanged[field]).map((field) => [field, ['Este título é compartilhado com outras bibliotecas; não é possível alterar os dados editoriais por aqui.']]),
      );
      throw new ApiError(422, 'SHARED_PUBLICATION_METADATA_LOCKED', 'Este título é compartilhado com outras bibliotecas.', fields);
    }
  }

  const nextIsbn = isbnUnchanged ? publication.isbn : (classified?.normalized ?? null);
  const nextIsbn10 = isbnUnchanged ? undefined : (classified?.isbn10 ?? null);
  const nextIsbn13 = isbnUnchanged ? undefined : (classified?.isbn13 ?? null);

  const statements = [
    nextIsbn10 === undefined
      ? db.prepare('UPDATE publications SET title=?,isbn=?,cover_url=?,cover_source_url=?,cover_source_note=?,updated_at=? WHERE id=?')
          .bind(input.title, nextIsbn, cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), now, publicationId)
      : db.prepare('UPDATE publications SET title=?,isbn=?,isbn10=?,isbn13=?,cover_url=?,cover_source_url=?,cover_source_note=?,updated_at=? WHERE id=?')
          .bind(input.title, nextIsbn, nextIsbn10, nextIsbn13, cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), now, publicationId),
    db.prepare('UPDATE game_systems SET name=?,normalized_name=?,updated_at=? WHERE id=?')
      .bind(input.title, normalizeLibraryName(input.title), now, publication.game_system_id),
    db.prepare(`UPDATE rpgs SET title=?,category_id=?,subgenre_id=?,reading_status=?,has_played=?,wants_to_play=?,priority=?,
      play_group_notes=?,play_group_id=?,planned_play_date=?,table_status=?,game_master=?,notes=?,updated_at=? WHERE id=? AND user_id=?`)
      .bind(input.title, cleanNullable(input.categoryId), cleanNullable(input.subgenreId), input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
        input.playGroupNotes, cleanNullable(input.playGroupId), cleanNullable(input.plannedPlayDate), input.tableStatus, input.gameMaster, input.notes, now, entryId, userId),
  ];
  return statements;
}

// JOIN canônico de leitura: toda rota que precisa dos campos editoriais
// (title/coverUrl/isbn/coverSourceUrl/coverSourceNote) de um User Library Entry
// usa esta mesma junção — `publications` é a fonte de verdade para esses campos
// desde LIB-002, não mais as colunas legadas homônimas em `rpgs` (mantidas
// fisicamente por segurança de rollback, mas não lidas pelo app).
export const LIBRARY_ENTRY_JOIN = 'LEFT JOIN publications p ON p.id=r.publication_id';
