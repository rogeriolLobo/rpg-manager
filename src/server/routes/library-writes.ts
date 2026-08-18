// LIB-002/LIB-003/LIB-004: camada canônica de escrita do domínio Game System +
// Publication + User Library Entry + Publication External IDs, compartilhada
// entre o cadastro/edição manual (rpgs.ts, incluindo o fluxo de busca externa
// confirmada em preview) e o import CSV (transfer.ts) — ver
// docs/library/LIBRARY_ARCHITECTURE.md, docs/library/PUBLICATION_IDENTITY.md
// e docs/library/METADATA_PROVIDERS.md. Único lugar que sabe como as tabelas
// se relacionam; nenhuma outra rota deve montar esses INSERTs/UPDATEs por
// conta própria (seção 18 do pedido LIB-002: "não manter um caminho paralelo
// incompatível").
import { classifyIsbn, type ClassifiedIsbn } from '../../domain/rpg/isbn';
import { DEFAULT_PUBLICATION_TYPE, normalizeLibraryName } from '../../domain/rpg/library-domain';
import type { RpgInput } from '../../shared/validation/schemas';
import { ApiError, cleanNullable } from '../http';

export interface LibraryEntryIds { entryId: string; gameSystemId: string; publicationId: string }

interface ExistingPublicationRow {
  id: string; game_system_id: string; title: string; isbn: string | null;
  cover_url: string | null; cover_source_url: string | null; cover_source_note: string | null;
  subtitle: string; publisher: string; publication_year: number | null; language: string;
  publication_type: string; authors: string;
}

const PUBLICATION_COLUMNS = 'id,game_system_id,title,isbn,cover_url,cover_source_url,cover_source_note,subtitle,publisher,publication_year,language,publication_type,authors';

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
  return db.prepare(`SELECT ${PUBLICATION_COLUMNS} FROM publications WHERE isbn13=?`).bind(isbn13).first<ExistingPublicationRow>();
}

// LIB-004: identidade também por (provider, external ID) — "External Edition ID já
// existe -> reutilizar Publication" (seção 17 do pedido). Edition é preferida sobre
// Work por ser mais precisa (seção 13); Work só é usada quando não há Edition.
async function findPublicationByExternalId(db: D1Database, provider: string, externalId: string): Promise<ExistingPublicationRow | null> {
  return db.prepare(`SELECT ${PUBLICATION_COLUMNS.split(',').map((c) => `p.${c}`).join(',')} FROM publication_external_ids e JOIN publications p ON p.id=e.publication_id WHERE e.provider=? AND e.external_id=?`)
    .bind(provider, externalId).first<ExistingPublicationRow>();
}

// LIB-006: inclui archived_at — uma Library Entry ARQUIVADA continua contando
// como referência existente (nunca cria uma segunda linha para a mesma
// Publication; ver classifyLibraryEntryState e docs/library/LIBRARY_ARCHIVE.md).
async function findLibraryEntryForPublication(db: D1Database, userId: string, publicationId: string): Promise<{ id: string; archivedAt: string | null } | null> {
  const row = await db.prepare('SELECT id,archived_at FROM rpgs WHERE user_id=? AND publication_id=?').bind(userId, publicationId).first<{ id: string; archived_at: string | null }>();
  return row ? { id: row.id, archivedAt: row.archived_at } : null;
}

// LIB-006: usado por /rpgs/search-external para informar, por resultado, se a
// Publication já é uma Library Entry do usuário atual (ativa ou arquivada) —
// evita duplicar/errar a mensagem de "já no catálogo" quando na verdade está
// arquivada (seção 16 do pedido LIB-006).
export async function findUserLibraryEntriesByPublicationIds(
  db: D1Database, userId: string, publicationIds: string[],
): Promise<Map<string, { id: string; archivedAt: string | null }>> {
  const unique = [...new Set(publicationIds)];
  if (!unique.length) return new Map();
  const rows = await db.prepare(`SELECT id,publication_id,archived_at FROM rpgs WHERE user_id=? AND publication_id IN (${unique.map(() => '?').join(',')})`)
    .bind(userId, ...unique).all<{ id: string; publication_id: string; archived_at: string | null }>();
  return new Map(rows.results.map((row) => [row.publication_id, { id: row.id, archivedAt: row.archived_at }]));
}

// LIB-004A: resolve um `reusePublicationId` vindo do catálogo interno (seção 9
// do pedido) — sempre revalidado contra o banco real, nunca confiado
// cegamente (um ID inexistente/apagado simplesmente não é encontrado, e o
// resto do pipeline de identidade continua normalmente a partir daí).
async function findPublicationById(db: D1Database, id: string): Promise<ExistingPublicationRow | null> {
  return db.prepare(`SELECT ${PUBLICATION_COLUMNS} FROM publications WHERE id=?`).bind(id).first<ExistingPublicationRow>();
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
// por ISBN/external ID) — usado tanto pelo create manual (via
// buildCreateLibraryEntryStatements) quanto pelo import CSV (classificação
// EXISTING_PUBLICATION em transfer.ts). Nunca escreve em publications/
// game_systems — metadata compartilhada não é alterada por um reuso.
export function buildLinkExistingPublicationStatement(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; publicationId: string; now: string },
): D1PreparedStatement {
  return buildRpgInsertStatement(db, params);
}

// LIB-004: registra provenance externa (provider, external ID) sem nunca
// sobrescrever a linha em `publications` (independente da trava de metadata
// compartilhada — é uma tabela separada, só soma identidade, nunca modifica
// título/capa/etc.). INSERT OR IGNORE: se o par (provider, external_id) já
// existir (UNIQUE, migration 0017), é um no-op seguro — nunca duplica nem
// reatribui a outra Publication.
function externalIdStatements(db: D1Database, publicationId: string, input: RpgInput, now: string): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (input.metadataSource !== 'OPEN_LIBRARY') return statements;
  if (input.externalEditionId) {
    statements.push(db.prepare('INSERT OR IGNORE INTO publication_external_ids (id,publication_id,provider,external_id,external_type,created_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), publicationId, 'OPEN_LIBRARY', input.externalEditionId, 'EDITION', now));
  }
  if (input.externalWorkId) {
    statements.push(db.prepare('INSERT OR IGNORE INTO publication_external_ids (id,publication_id,provider,external_id,external_type,created_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), publicationId, 'OPEN_LIBRARY', input.externalWorkId, 'WORK', now));
  }
  return statements;
}

// LIB-003/LIB-004/LIB-004A: identidade + dedup seguro. Prioridade de resolução
// (seção 4/17 do pedido LIB-003/004, seção 9 do pedido LIB-004A): (1)
// reusePublicationId do catálogo interno — o usuário já viu e escolheu
// explicitamente esta Publication existente; (2) Edition ID externo, (3) Work
// ID externo, (4) ISBN-13 (direto ou derivado de ISBN-10). Encontrado em
// qualquer conta (publications não têm dono, são catálogo compartilhado,
// mesmo modelo de categories/subgenres) -> reaproveita, só cria a nova User
// Library Entry. Nada encontrado -> cria Game System + Publication novos.
// Nunca deduplica por título sozinho (só por identificador confiável).
export async function buildCreateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; input: RpgInput; now: string },
): Promise<{ statements: D1PreparedStatement[]; ids: LibraryEntryIds; reusedExistingPublication: boolean }> {
  const { entryId, userId, input, now } = params;
  const classified = classifyIsbn(input.isbn ?? null);

  let existing: ExistingPublicationRow | null = null;
  if (input.reusePublicationId) existing = await findPublicationById(db, input.reusePublicationId);
  if (!existing && input.metadataSource === 'OPEN_LIBRARY' && input.externalEditionId) existing = await findPublicationByExternalId(db, 'OPEN_LIBRARY', input.externalEditionId);
  if (!existing && input.metadataSource === 'OPEN_LIBRARY' && input.externalWorkId) existing = await findPublicationByExternalId(db, 'OPEN_LIBRARY', input.externalWorkId);
  if (!existing && classified) existing = await findPublicationByIsbn13(db, classified.isbn13!);

  if (existing) {
    const alreadyInLibrary = await findLibraryEntryForPublication(db, userId, existing.id);
    if (alreadyInLibrary?.archivedAt) {
      // LIB-006: arquivada != ausente — nunca cria uma segunda linha para a mesma
      // Publication; oferece o ID existente para a UI propor "Restaurar" em vez de
      // um erro genérico (seção 15 do pedido LIB-006).
      throw new ApiError(409, 'ARCHIVED_IN_LIBRARY', 'Este título está arquivado na sua biblioteca.', { libraryEntryId: [alreadyInLibrary.id] });
    }
    if (alreadyInLibrary) throw new ApiError(409, 'ALREADY_IN_LIBRARY', 'Você já tem este título na sua biblioteca.');
    const statements = [buildRpgInsertStatement(db, { entryId, userId, input, publicationId: existing.id, now }), ...externalIdStatements(db, existing.id, input, now)];
    return { statements, ids: { entryId, gameSystemId: existing.game_system_id, publicationId: existing.id }, reusedExistingPublication: true };
  }

  const gameSystemId = `gs_${crypto.randomUUID()}`;
  const publicationId = `pub_${crypto.randomUUID()}`;
  const metadataSource = input.metadataSource ?? 'MANUAL';
  const statements = [
    db.prepare('INSERT INTO game_systems (id,name,normalized_name,publisher,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(gameSystemId, input.title, normalizeLibraryName(input.title), '', '', now, now),
    db.prepare(`INSERT INTO publications (id,game_system_id,publication_type,title,subtitle,edition,publisher,publication_year,language,isbn,isbn10,isbn13,description,cover_url,cover_source_url,cover_source_note,authors,metadata_source,metadata_source_id,metadata_source_url,metadata_fetched_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(publicationId, gameSystemId, input.publicationType ?? DEFAULT_PUBLICATION_TYPE, input.title, cleanNullable(input.subtitle) ?? '', '', cleanNullable(input.publisher) ?? '',
        input.publicationYear ?? null, cleanNullable(input.language) ?? '', classified?.normalized ?? cleanNullable(input.isbn), classified?.isbn10 ?? null, classified?.isbn13 ?? null, '',
        cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), cleanNullable(input.authors) ?? '',
        metadataSource, metadataSource === 'MANUAL' ? null : cleanNullable(input.metadataSourceId), metadataSource === 'MANUAL' ? null : cleanNullable(input.metadataSourceUrl),
        metadataSource === 'MANUAL' ? null : cleanNullable(input.metadataFetchedAt), now, now),
    buildRpgInsertStatement(db, { entryId, userId, input, publicationId, now }),
    ...externalIdStatements(db, publicationId, input, now),
  ];
  return { statements, ids: { entryId, gameSystemId, publicationId }, reusedExistingPublication: false };
}

const METADATA_FIELDS = ['title', 'isbn', 'coverUrl', 'coverSourceUrl', 'coverSourceNote', 'subtitle', 'publisher', 'publicationYear', 'language', 'publicationType', 'authors'] as const;

// LIB-003/LIB-005: checagem única da trava de metadata compartilhada —
// reutilizada pelo update de RPG (campos editoriais em geral) e pelo upload/
// remoção de capa (LIB-005, src/server/routes/rpgs.ts), que é uma mudança
// editorial da mesma Publication por uma via diferente do formulário
// principal. `fields` define a mensagem por campo específica de cada
// chamador — o critério (COUNT(*) > 1) é sempre o mesmo.
export async function assertSharedPublicationEditable(db: D1Database, publicationId: string, fields: Record<string, string[]>): Promise<void> {
  const referenceCount = await db.prepare('SELECT COUNT(*) total FROM rpgs WHERE publication_id=?').bind(publicationId).first<{ total: number }>();
  if (Number(referenceCount?.total ?? 1) > 1) {
    throw new ApiError(422, 'SHARED_PUBLICATION_METADATA_LOCKED', 'Este título é compartilhado com outras bibliotecas.', fields);
  }
}

// LIB-003/LIB-004: metadata editorial (título/ISBN/capa/subtítulo/editora/ano/
// idioma/tipo/autores) só pode ser alterada enquanto a Publication tiver 1 única
// User Library Entry — ver docs/library/PUBLICATION_IDENTITY.md ("Política de
// segurança para metadata compartilhada"). Estado pessoal nunca é afetado por
// essa trava. ISBN inalterado em relação ao persistido pula a validação de
// checksum (mesmo princípio do incidente de coverUrl — LIB-001, CLAUDE.md seção
// 18). PATCH nunca reatribui publication_id nem reescreve provenance/external
// IDs (isso só acontece no CREATE) — editar um RPG existente nunca "rebusca"
// nem troca a origem do dado.
export async function buildUpdateLibraryEntryStatements(
  db: D1Database,
  params: { entryId: string; userId: string; publicationId: string; input: RpgInput; now: string },
): Promise<D1PreparedStatement[]> {
  const { entryId, userId, publicationId, input, now } = params;
  const publication = await db.prepare(`SELECT ${PUBLICATION_COLUMNS} FROM publications WHERE id=?`).bind(publicationId).first<ExistingPublicationRow>();
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

  const nextSubtitle = cleanNullable(input.subtitle) ?? '';
  const nextPublisher = cleanNullable(input.publisher) ?? '';
  const nextPublicationYear = input.publicationYear ?? null;
  const nextLanguage = cleanNullable(input.language) ?? '';
  const nextPublicationType = input.publicationType ?? publication.publication_type;
  const nextAuthors = cleanNullable(input.authors) ?? '';

  const metadataChanged = {
    title: input.title !== publication.title,
    isbn: !isbnUnchanged,
    coverUrl: cleanNullable(input.coverUrl) !== publication.cover_url,
    coverSourceUrl: cleanNullable(input.coverSourceUrl) !== publication.cover_source_url,
    coverSourceNote: cleanNullable(input.coverSourceNote) !== publication.cover_source_note,
    subtitle: nextSubtitle !== publication.subtitle,
    publisher: nextPublisher !== publication.publisher,
    publicationYear: nextPublicationYear !== publication.publication_year,
    language: nextLanguage !== publication.language,
    publicationType: nextPublicationType !== publication.publication_type,
    authors: nextAuthors !== publication.authors,
  };
  const anyMetadataChanged = METADATA_FIELDS.some((field) => metadataChanged[field]);

  if (anyMetadataChanged) {
    const fields = Object.fromEntries(
      METADATA_FIELDS.filter((field) => metadataChanged[field]).map((field) => [field, ['Este título é compartilhado com outras bibliotecas; não é possível alterar os dados editoriais por aqui.']]),
    );
    await assertSharedPublicationEditable(db, publicationId, fields);
  }

  const nextIsbn = isbnUnchanged ? publication.isbn : (classified?.normalized ?? null);
  const nextIsbn10 = isbnUnchanged ? undefined : (classified?.isbn10 ?? null);
  const nextIsbn13 = isbnUnchanged ? undefined : (classified?.isbn13 ?? null);

  const statements = [
    nextIsbn10 === undefined
      ? db.prepare(`UPDATE publications SET title=?,isbn=?,cover_url=?,cover_source_url=?,cover_source_note=?,subtitle=?,publisher=?,publication_year=?,language=?,publication_type=?,authors=?,updated_at=? WHERE id=?`)
          .bind(input.title, nextIsbn, cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), nextSubtitle, nextPublisher, nextPublicationYear, nextLanguage, nextPublicationType, nextAuthors, now, publicationId)
      : db.prepare(`UPDATE publications SET title=?,isbn=?,isbn10=?,isbn13=?,cover_url=?,cover_source_url=?,cover_source_note=?,subtitle=?,publisher=?,publication_year=?,language=?,publication_type=?,authors=?,updated_at=? WHERE id=?`)
          .bind(input.title, nextIsbn, nextIsbn10, nextIsbn13, cleanNullable(input.coverUrl), cleanNullable(input.coverSourceUrl), cleanNullable(input.coverSourceNote), nextSubtitle, nextPublisher, nextPublicationYear, nextLanguage, nextPublicationType, nextAuthors, now, publicationId),
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
// (title/coverUrl/isbn/coverSourceUrl/coverSourceNote/subtitle/publisher/...)
// de um User Library Entry usa esta mesma junção — `publications` é a fonte de
// verdade para esses campos desde LIB-002, não mais as colunas legadas
// homônimas em `rpgs` (mantidas fisicamente por segurança de rollback, mas não
// lidas pelo app).
export const LIBRARY_ENTRY_JOIN = 'LEFT JOIN publications p ON p.id=r.publication_id';
