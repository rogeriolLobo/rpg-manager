import { Hono, type Context } from 'hono';
import { classifyIsbn } from '../../domain/rpg/isbn';
import { MetadataProviderError, type BookMetadataResult } from '../../domain/rpg/metadata-provider';
import { calculateRpgNextAction, calculateRpgReadiness, calculateRpgRecommendationScore, type RecommendationCandidate } from '../../domain/rpg/recommendation';
import { openLibraryProvider } from '../providers/open-library';
import { findInternalPublicationByIsbn13, searchInternalCatalog } from '../search/internal-catalog';
import { UrlImportError, extractPageMetadata, fetchHtmlWithSsrfProtection, validateImportUrl } from '../security/url-import';
import { isPublicHttpsUrl } from '../../shared/security/cover-url';
import { coverAssetKvKey, MAX_COVER_ASSET_BYTES, sniffCoverAssetContentType } from '../../domain/rpg/cover-asset';
import { rpgInputSchema, rpgUpdateInputSchema, urlImportSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';
import { LIBRARY_ENTRY_JOIN, assertSharedPublicationEditable, buildCreateLibraryEntryStatements, buildUpdateLibraryEntryStatements } from './library-writes';

export const rpgRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const RESULT_LIMIT = 10;

// LIB-004: fixture determinística para E2E — ver rota /search-external abaixo.
const E2E_FIXTURE_RESULTS: BookMetadataResult[] = [{
  source: 'OPEN_LIBRARY', origin: 'OPEN_LIBRARY', confidence: 'EXACT', workId: 'OLE2EW', editionId: 'OLE2EM',
  sourceUrl: 'https://openlibrary.org/books/OLE2EM',
  title: 'Aventuras de Teste', subtitle: 'Edição de Testes E2E', authors: 'Autora Fixture',
  publisher: 'Editora Fixture', publicationYear: 2024, language: 'por',
  isbn10: undefined, isbn13: '9783161484100', coverUrl: undefined,
}];

// LIB-004A: fixture determinística para E2E do fluxo "Importar de uma página
// oficial" — mesma trava de ambiente (nunca alcançável em produção). Chave
// pelo hostname (não pelo path/query), porque a validação de URL real roda
// antes de checar a fixture (a URL ainda precisa ser HTTPS válida).
const E2E_IMPORT_FIXTURE_HOST = 'e2e-fixture.rpg-manager.invalid';
const E2E_IMPORT_FIXTURE_RESULT: BookMetadataResult = {
  source: 'URL_IMPORT', origin: 'URL_IMPORT', confidence: 'HIGH', workId: null, editionId: null,
  sourceUrl: `https://${E2E_IMPORT_FIXTURE_HOST}/produto-fixture`,
  title: 'Produto Importado de Teste', subtitle: undefined, authors: 'Autora da Página Fixture',
  publisher: 'Editora da Página Fixture', publicationYear: 2021, language: undefined,
  isbn10: undefined, isbn13: undefined, coverUrl: undefined,
};

// LIB-002: title/coverUrl/isbn/coverSourceUrl/coverSourceNote vêm de `publications`
// (p.*), a fonte de verdade editorial desde a normalização de domínio — não mais
// das colunas homônimas em `rpgs`, mantidas fisicamente por segurança de rollback
// mas não lidas pelo app (ver src/server/routes/library-writes.ts).
interface RpgRow {
  id: string; publication_id: string | null; title: string; category_id: string | null; category_name: string | null; subgenre_id: string | null; subgenre_name: string | null;
  reading_status: RecommendationCandidate['readingStatus']; has_played: number; wants_to_play: number; priority: RecommendationCandidate['priority'];
  play_group_notes: string; planned_play_date: string | null; table_status: RecommendationCandidate['tableStatus']; game_master: string; notes: string;
  play_group_id: string | null; play_group_name: string | null; cover_url: string | null; isbn: string | null;
  cover_source_url: string | null; cover_source_note: string | null; created_at: string; updated_at: string;
  // LIB-005: capa por upload (Zero Cost — KV) — quando presente, tem prioridade
  // sobre cover_url na apresentação (ver present() abaixo). Nunca lido/escrito
  // pelo schema de coverUrl (rpgInputSchema) — mutação própria (rotas .../cover).
  cover_asset_id: string | null;
  // LIB-004: campos editoriais adicionais, sempre de `publications` (fonte de verdade).
  subtitle: string; authors: string; publisher: string; publication_year: number | null; language: string;
  publication_type: string; metadata_source: string;
}

function present(row: RpgRow) {
  const title = row.title;
  const candidate: RecommendationCandidate = {
    title, readingStatus: row.reading_status, hasPlayed: Boolean(row.has_played), wantsToPlay: Boolean(row.wants_to_play),
    priority: row.priority, hasPlayGroup: Boolean(row.play_group_id || row.play_group_notes.trim()), tableStatus: row.table_status,
  };
  return {
    id: row.id, title, categoryId: row.category_id, categoryName: row.category_name, subgenreId: row.subgenre_id,
    subgenreName: row.subgenre_name, readingStatus: row.reading_status, hasPlayed: candidate.hasPlayed, wantsToPlay: candidate.wantsToPlay,
    priority: row.priority, playGroupId: row.play_group_id, playGroupName: row.play_group_name, playGroupNotes: row.play_group_notes, plannedPlayDate: row.planned_play_date, tableStatus: row.table_status,
    gameMaster: row.game_master, notes: row.notes, coverUrl: row.cover_url, isbn: row.isbn, coverSourceUrl: row.cover_source_url,
    coverSourceNote: row.cover_source_note, coverAssetId: row.cover_asset_id, createdAt: row.created_at, updatedAt: row.updated_at,
    subtitle: row.subtitle, authors: row.authors, publisher: row.publisher, publicationYear: row.publication_year, language: row.language,
    publicationType: row.publication_type, metadataSource: row.metadata_source,
    recommendationScore: calculateRpgRecommendationScore(candidate), readiness: calculateRpgReadiness(candidate), nextAction: calculateRpgNextAction(candidate),
  };
}

const SELECT = `SELECT r.id,r.publication_id,COALESCE(p.title,r.title) title,r.category_id,c.name category_name,r.subgenre_id,s.name subgenre_name,
  r.reading_status,r.has_played,r.wants_to_play,r.priority,r.play_group_notes,r.play_group_id,g.name play_group_name,r.planned_play_date,r.table_status,
  r.game_master,r.notes,p.cover_url cover_url,COALESCE(p.isbn,r.isbn) isbn,p.cover_source_url cover_source_url,p.cover_source_note cover_source_note,
  p.cover_asset_id cover_asset_id,
  COALESCE(p.subtitle,'') subtitle,COALESCE(p.authors,'') authors,COALESCE(p.publisher,'') publisher,p.publication_year publication_year,
  COALESCE(p.language,'') language,COALESCE(p.publication_type,'CORE_RULEBOOK') publication_type,COALESCE(p.metadata_source,'MANUAL') metadata_source,
  r.created_at,r.updated_at FROM rpgs r
  ${LIBRARY_ENTRY_JOIN} LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN subgenres s ON s.id=r.subgenre_id LEFT JOIN play_groups g ON g.id=r.play_group_id`;

async function validateTaxonomy(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  categoryId: string | null | undefined,
  subgenreId: string | null | undefined,
): Promise<void> {
  if (!subgenreId) return;
  if (!categoryId) throw new ApiError(422, 'INVALID_TAXONOMY', 'O subgênero exige uma categoria.');
  const subgenre = await c.env.DB.prepare('SELECT id FROM subgenres WHERE id=? AND category_id=?').bind(subgenreId, categoryId).first();
  if (!subgenre) throw new ApiError(422, 'INVALID_TAXONOMY', 'O subgênero não pertence à categoria selecionada.');
}

async function validateGroup(c: Context<{ Bindings: Env; Variables: AppVariables }>, playGroupId: string | null | undefined): Promise<void> {
  if (!playGroupId) return;
  const group = await c.env.DB.prepare('SELECT id FROM play_groups WHERE id=? AND user_id=?').bind(playGroupId, c.get('user').id).first();
  if (!group) throw new ApiError(422, 'INVALID_PLAY_GROUP', 'Grupo de jogo inválido.');
}

rpgRoutes.get('/metadata', async (c) => {
  const [categories, subgenres, groups] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,name FROM categories ORDER BY sort_order,name'),
    c.env.DB.prepare('SELECT id,category_id categoryId,name FROM subgenres ORDER BY name'),
    c.env.DB.prepare(`SELECT g.id,g.name,(SELECT COALESCE(u.display_name,m.player_name) FROM play_group_members m
      LEFT JOIN users u ON u.id=m.user_id WHERE m.group_id=g.id AND m.is_game_master=1 LIMIT 1) gameMasterName
      FROM play_groups g WHERE g.user_id=? ORDER BY g.name COLLATE NOCASE`).bind(c.get('user').id),
  ]);
  return c.json({ categories: categories.results, subgenres: subgenres.results, groups: groups.results });
});

// LIB-004/LIB-004A: busca de Publication — catálogo interno (nosso próprio
// banco: título + aliases confirmados) SEMPRE primeiro (seção 9 do pedido),
// depois Open Library (host fixo no provider — nunca aceita URL/host vindo do
// usuário, diferente do fluxo de coverUrl externo). Autenticado (herdado de
// requireAuth em /api/v1/rpgs/*), rate limit local (reaproveita
// DIRECTORY_RATE_LIMITER com chave própria), timeout+erro amigável (nunca
// derruba a Biblioteca). Não persiste nada — só devolve candidatos para o
// usuário revisar (preview obrigatório antes de qualquer escrita).
//
// LIB-004A: cada candidato carrega uma `confidence` calculada LOCALMENTE
// (nunca confiamos apenas na ordenação de relevância do provider — ver
// src/domain/rpg/search-relevance.ts e o incidente real documentado em
// docs/library/METADATA_PROVIDERS.md). Resultados abaixo do limiar de
// confiança nunca chegam à resposta — "nenhum resultado confiável" é
// preferível a apresentar um livro errado.
rpgRoutes.get('/search-external', async (c) => {
  const query = (c.req.query('q') ?? '').trim();
  if (query.length < 2 || query.length > 200) throw new ApiError(422, 'INVALID_SEARCH_QUERY', 'Digite entre 2 e 200 caracteres para buscar.');
  const rateLimit = await c.env.DIRECTORY_RATE_LIMITER.limit({ key: `metadata-search:${c.get('user').id}` });
  if (!rateLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas buscas. Aguarde antes de tentar novamente.');
  // LIB-004: seam determinístico só para E2E (Playwright não intercepta fetch server-side —
  // só o navegador). Travado atrás de duas condições: ambiente != production (nunca alcançável
  // em produção, mesmo que alguém digite o prefixo mágico) E o prefixo exato na query. Nenhuma
  // chamada real à Open Library acontece nesse caminho — ver tests/e2e/rpg-online-search.spec.ts.
  if (c.env.ENVIRONMENT !== 'production' && query.startsWith('__e2e_fixture__')) {
    if (query.includes('provider-error')) throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível consultar a Open Library agora. Você ainda pode cadastrar o livro manualmente.');
    return c.json({ results: query.includes('no-results') ? [] : E2E_FIXTURE_RESULTS });
  }
  const classified = classifyIsbn(query);
  if (classified?.isbn13) {
    // ISBN é o identificador mais forte (seção 3) — catálogo interno primeiro, senão Open Library.
    const internal = await findInternalPublicationByIsbn13(c.env.DB, classified.isbn13);
    if (internal) return c.json({ results: [internal] });
    try {
      const found = await openLibraryProvider.lookupByIsbn(classified.isbn13);
      return c.json({ results: found ? [found] : [] });
    } catch (error) {
      if (!(error instanceof MetadataProviderError)) throw error;
      console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), operation: 'METADATA_SEARCH', provider: 'OPEN_LIBRARY', reason: error.reason }));
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível consultar a Open Library agora. Você ainda pode cadastrar o livro manualmente.');
    }
  }
  const internalResults = await searchInternalCatalog(c.env.DB, query);
  let externalResults: BookMetadataResult[] = [];
  try {
    externalResults = await openLibraryProvider.search(query);
  } catch (error) {
    if (!(error instanceof MetadataProviderError)) throw error;
    console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), operation: 'METADATA_SEARCH', provider: 'OPEN_LIBRARY', reason: error.reason }));
    // Catálogo interno já pode ter resultado útil mesmo com a Open Library fora do ar —
    // só falha a busca inteira se não houver NADA para mostrar (seção 8 do pedido original).
    if (!internalResults.length) throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'Não foi possível consultar a Open Library agora. Você ainda pode cadastrar o livro manualmente.');
  }
  return c.json({ results: [...internalResults, ...externalResults].slice(0, RESULT_LIMIT) });
});

// LIB-004A: fallback "Importar de uma página oficial" (seção 10 do pedido) —
// único endpoint do domínio de metadata em que o HOST vem do usuário, por
// isso a validação SSRF dedicada (src/server/security/url-import.ts). Nunca
// salva nada — só devolve um preview para revisão manual, mesmo contrato de
// "preview obrigatório" do restante da busca.
rpgRoutes.post('/import-url', async (c) => {
  const input = await readJson(c, urlImportSchema);
  const rateLimit = await c.env.DIRECTORY_RATE_LIMITER.limit({ key: `url-import:${c.get('user').id}` });
  if (!rateLimit.success) throw new ApiError(429, 'RATE_LIMITED', 'Muitas importações. Aguarde antes de tentar novamente.');
  const { url } = validateImportUrl(input.url);
  if (c.env.ENVIRONMENT !== 'production' && url.hostname === E2E_IMPORT_FIXTURE_HOST) {
    return c.json({ result: E2E_IMPORT_FIXTURE_RESULT });
  }
  try {
    const html = await fetchHtmlWithSsrfProtection(url);
    const extracted = await extractPageMetadata(html);
    if (!extracted.title) throw new ApiError(422, 'IMPORT_NO_METADATA', 'Não encontramos dados suficientes nessa página. Você ainda pode cadastrar manualmente.');
    const classified = classifyIsbn(extracted.isbn ?? null); // nunca confia cego no ISBN extraído da página.
    let coverUrl: string | undefined;
    if (extracted.coverUrl) {
      const resolved = new URL(extracted.coverUrl, url).toString();
      if (isPublicHttpsUrl(resolved)) coverUrl = resolved;
    }
    const result: BookMetadataResult = {
      source: 'URL_IMPORT', origin: 'URL_IMPORT', confidence: 'HIGH', workId: null, editionId: null,
      sourceUrl: url.toString(), title: extracted.title, subtitle: extracted.subtitle,
      authors: extracted.authors, publisher: extracted.publisher, publicationYear: extracted.publicationYear,
      language: extracted.language, // LIB-004C: WebPage.inLanguage (JSON-LD) — sinal seguro, novo.
      isbn10: classified?.isbn10 ?? undefined, isbn13: classified?.isbn13 ?? undefined, coverUrl,
    };
    return c.json({ result });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (!(error instanceof UrlImportError)) throw error;
    console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), operation: 'URL_IMPORT', reason: error.reason }));
    throw new ApiError(502, 'IMPORT_UNAVAILABLE', 'Não foi possível importar essa página agora. Você ainda pode cadastrar manualmente.');
  }
});

rpgRoutes.get('/', async (c) => {
  const user = c.get('user');
  const query = c.req.query();
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.pageSize ?? '24', 10) || 24));
  const where = ['r.user_id=?']; const values: unknown[] = [user.id];
  if (query.search) { where.push('r.title LIKE ? ESCAPE \'\\\''); values.push(`%${query.search.slice(0, 100).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`); }
  const filters: Record<string, string> = { category: 'r.category_id', subgenre: 'r.subgenre_id', readingStatus: 'r.reading_status', priority: 'r.priority', tableStatus: 'r.table_status' };
  for (const [key, column] of Object.entries(filters)) if (query[key]) { where.push(`${column}=?`); values.push(query[key]); }
  if (query.hasPlayed === 'true' || query.hasPlayed === 'false') { where.push('r.has_played=?'); values.push(query.hasPlayed === 'true' ? 1 : 0); }
  if (query.wantsToPlay === 'true' || query.wantsToPlay === 'false') { where.push('r.wants_to_play=?'); values.push(query.wantsToPlay === 'true' ? 1 : 0); }
  const recommendationScore = `(CASE WHEN r.wants_to_play=1 THEN 100 ELSE 0 END + CASE r.priority WHEN 'HIGH' THEN 40 WHEN 'MEDIUM' THEN 25 WHEN 'LOW' THEN 10 ELSE 0 END + CASE WHEN r.reading_status='READ' THEN 30 ELSE 0 END + CASE WHEN r.play_group_id IS NOT NULL OR length(trim(r.play_group_notes))>0 THEN 20 ELSE 0 END + CASE WHEN r.has_played=1 THEN -20 ELSE 20 END + CASE r.table_status WHEN 'PREPARING' THEN 15 WHEN 'SCHEDULED' THEN 20 WHEN 'PLAYING' THEN 25 ELSE 0 END)`;
  const orderBy: Record<string, string> = {
    title: 'r.title COLLATE NOCASE',
    priority: "CASE r.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,r.title COLLATE NOCASE",
    readiness: `${recommendationScore} DESC,r.wants_to_play DESC,CASE r.priority WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC,CASE WHEN r.reading_status='READ' THEN 1 ELSE 0 END DESC,CASE WHEN r.play_group_id IS NOT NULL OR length(trim(r.play_group_notes))>0 THEN 1 ELSE 0 END DESC,r.title COLLATE NOCASE`,
    recent: 'r.created_at DESC',
  };
  const order = orderBy[query.sort ?? 'title'] ?? orderBy.title;
  const clause = where.join(' AND ');
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(`${SELECT} WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) total FROM rpgs r WHERE ${clause}`).bind(...values),
  ]);
  const items = (rows.results as unknown as RpgRow[]).map(present);
  return c.json({ items, pagination: { page, pageSize, total: Number((count.results[0] as { total: number }).total) } });
});

rpgRoutes.post('/', async (c) => {
  const input = await readJson(c, rpgInputSchema); const user = c.get('user'); const id = crypto.randomUUID(); const now = nowIso();
  await validateTaxonomy(c, input.categoryId, input.subgenreId);
  await validateGroup(c, input.playGroupId);
  // LIB-003: pode lançar ApiError(409 ALREADY_IN_LIBRARY) antes de qualquer escrita —
  // fora do try/catch abaixo de propósito, para não ser reclassificado como DUPLICATE_RPG.
  const { statements } = await buildCreateLibraryEntryStatements(c.env.DB, { entryId: id, userId: user.id, input, now });
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes('isbn13') || message.includes('isbn10')) throw new ApiError(409, 'DUPLICATE_ISBN', 'Este ISBN já pertence a outra publicação no catálogo.');
    if (message.includes('UNIQUE')) throw new ApiError(409, 'DUPLICATE_RPG', 'Já existe um RPG com este título.');
    throw error;
  }
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(id, user.id).first<RpgRow>();
  return c.json({ item: present(row!) }, 201);
});

rpgRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(c.req.param('id'), c.get('user').id).first<RpgRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  const campaigns = await c.env.DB.prepare('SELECT id,name,status,next_session_date nextSessionDate FROM campaigns WHERE rpg_id=? AND user_id=? ORDER BY created_at DESC')
    .bind(row.id, c.get('user').id).all();
  return c.json({ item: present(row), campaigns: campaigns.results });
});

rpgRoutes.patch('/:id', async (c) => {
  // LIB-003: schema mais permissivo na forma do isbn — a checagem real de checksum só roda
  // se o valor mudou em relação ao persistido (ver buildUpdateLibraryEntryStatements).
  const input = await readJson(c, rpgUpdateInputSchema); const user = c.get('user'); const entryId = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id,publication_id FROM rpgs WHERE id=? AND user_id=?').bind(entryId, user.id).first<{ id: string; publication_id: string | null }>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  await validateTaxonomy(c, input.categoryId, input.subgenreId);
  await validateGroup(c, input.playGroupId);
  // publication_id sempre presente após o backfill do LIB-002 (toda criação nova também sempre
  // cria a Publication na mesma transação) — o fallback só evita quebrar num estado inconsistente
  // impossível de alcançar por código, não é um caminho suportado.
  // Pode lançar ApiError (ISBN inválido, ou SHARED_PUBLICATION_METADATA_LOCKED) antes de
  // qualquer escrita — fora do try/catch abaixo de propósito.
  const statements = existing.publication_id
    ? await buildUpdateLibraryEntryStatements(c.env.DB, { entryId, userId: user.id, publicationId: existing.publication_id, input, now: nowIso() })
    : [c.env.DB.prepare(`UPDATE rpgs SET title=?,category_id=?,subgenre_id=?,reading_status=?,has_played=?,wants_to_play=?,priority=?,
        play_group_notes=?,play_group_id=?,planned_play_date=?,table_status=?,game_master=?,notes=?,updated_at=? WHERE id=? AND user_id=?`)
        .bind(input.title, input.categoryId ?? null, input.subgenreId ?? null, input.readingStatus, Number(input.hasPlayed), Number(input.wantsToPlay), input.priority,
          input.playGroupNotes, input.playGroupId ?? null, input.plannedPlayDate ?? null, input.tableStatus, input.gameMaster, input.notes, nowIso(), entryId, user.id)];
  let results;
  try {
    results = await c.env.DB.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes('isbn13') || message.includes('isbn10')) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Dados inválidos.', { isbn: ['Este ISBN já pertence a outra publicação no catálogo.'] });
    }
    throw error;
  }
  if (!results.at(-1)!.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(entryId, user.id).first<RpgRow>();
  return c.json({ item: present(row!) });
});

rpgRoutes.delete('/:id', async (c) => {
  try {
    const result = await c.env.DB.prepare('DELETE FROM rpgs WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
    if (!result.meta.changes) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  } catch (error) { if (String(error).includes('FOREIGN KEY')) throw new ApiError(409, 'RPG_HAS_CAMPAIGNS', 'Exclua ou reassocie as campanhas antes de excluir este RPG.'); throw error; }
  return c.body(null, 204);
});

async function loadOwnedEntryPublication(c: Context<{ Bindings: Env; Variables: AppVariables }>, entryId: string): Promise<string> {
  const user = c.get('user');
  const existing = await c.env.DB.prepare('SELECT id,publication_id FROM rpgs WHERE id=? AND user_id=?').bind(entryId, user.id).first<{ id: string; publication_id: string | null }>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'RPG não encontrado.');
  // Defensivo: publication_id sempre presente após o backfill do LIB-002 (ver PATCH acima).
  if (!existing.publication_id) throw new ApiError(409, 'PUBLICATION_MISSING', 'Este RPG ainda não tem uma publicação associada.');
  return existing.publication_id;
}

const SHARED_COVER_LOCK_FIELDS = { cover: ['Este título é compartilhado com outras bibliotecas; não é possível alterar a capa por aqui.'] };

// LIB-005: upload de capa (Zero Cost — Workers KV Free, ver
// docs/library/COVER_STORAGE.md). Ação independente do formulário principal de
// edição — não passa por rpgInputSchema/coverUrl, para não interagir com o
// fluxo de URL externa já corrigido (LIB-001, CLAUDE.md seção 18). Mesma trava
// de metadata compartilhada do resto do domínio editorial (LIB-003):
// só é permitido enquanto a Publication tiver 1 única User Library Entry.
//
// O cliente já reprocessa a imagem (decodifica/redimensiona/reexporta) antes
// de enviar (ver src/client/pages/library-pages.tsx), mas o servidor nunca
// confia nisso: valida bytes reais (magic bytes) e tamanho aqui, do zero.
rpgRoutes.post('/:id/cover', async (c) => {
  const entryId = c.req.param('id');
  const publicationId = await loadOwnedEntryPublication(c, entryId);
  await assertSharedPublicationEditable(c.env.DB, publicationId, SHARED_COVER_LOCK_FIELDS);

  const contentLength = Number(c.req.header('Content-Length') ?? '0');
  if (contentLength > MAX_COVER_ASSET_BYTES) throw new ApiError(413, 'COVER_TOO_LARGE', 'Imagem maior que o limite permitido (2MB).');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new ApiError(422, 'INVALID_UPLOAD', 'Envio inválido.');
  }
  const file = formData.get('cover');
  if (!(file instanceof File)) throw new ApiError(422, 'INVALID_UPLOAD', 'Selecione um arquivo de imagem.');
  if (file.size === 0) throw new ApiError(422, 'INVALID_UPLOAD', 'Arquivo vazio.');
  if (file.size > MAX_COVER_ASSET_BYTES) throw new ApiError(413, 'COVER_TOO_LARGE', 'Imagem maior que o limite permitido (2MB).');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffCoverAssetContentType(bytes);
  if (!contentType) throw new ApiError(422, 'INVALID_COVER_FORMAT', 'Envie uma imagem JPEG, PNG ou WebP.');

  const publication = await c.env.DB.prepare('SELECT cover_asset_id FROM publications WHERE id=?').bind(publicationId).first<{ cover_asset_id: string | null }>();
  const previousAssetId = publication?.cover_asset_id ?? null;
  const assetId = crypto.randomUUID();
  const now = nowIso();

  await c.env.COVERS_KV.put(coverAssetKvKey(assetId), bytes, { metadata: { contentType, uploadedAt: now, ownerUserId: c.get('user').id } });
  await c.env.DB.prepare('UPDATE publications SET cover_asset_id=?,updated_at=? WHERE id=?').bind(assetId, now, publicationId).run();
  // Best-effort: libera o asset anterior do KV (evita acumular lixo na cota gratuita).
  // Se falhar, não bloqueia a resposta — o asset novo já está corretamente vinculado.
  if (previousAssetId) {
    try { await c.env.COVERS_KV.delete(coverAssetKvKey(previousAssetId)); } catch { /* limpeza best-effort */ }
  }

  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(entryId, c.get('user').id).first<RpgRow>();
  return c.json({ item: present(row!) });
});

rpgRoutes.delete('/:id/cover', async (c) => {
  const entryId = c.req.param('id');
  const publicationId = await loadOwnedEntryPublication(c, entryId);
  await assertSharedPublicationEditable(c.env.DB, publicationId, SHARED_COVER_LOCK_FIELDS);

  const publication = await c.env.DB.prepare('SELECT cover_asset_id FROM publications WHERE id=?').bind(publicationId).first<{ cover_asset_id: string | null }>();
  if (!publication?.cover_asset_id) throw new ApiError(404, 'NOT_FOUND', 'Este RPG não tem capa enviada.');

  await c.env.DB.prepare('UPDATE publications SET cover_asset_id=NULL,updated_at=? WHERE id=?').bind(nowIso(), publicationId).run();
  try { await c.env.COVERS_KV.delete(coverAssetKvKey(publication.cover_asset_id)); } catch { /* limpeza best-effort */ }

  const row = await c.env.DB.prepare(`${SELECT} WHERE r.id=? AND r.user_id=?`).bind(entryId, c.get('user').id).first<RpgRow>();
  return c.json({ item: present(row!) });
});
