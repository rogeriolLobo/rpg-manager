// LIB-003: identidade de Publication, dedup seguro por ISBN, provenance e a
// política de segurança para metadata compartilhada — ver
// docs/library/PUBLICATION_IDENTITY.md. Arquivo separado de
// library-domain.test.ts (LIB-002) por escopo; mesmo aviso de isolamento se
// aplica aqui: testes deste arquivo compartilham o D1 dentro do mesmo run
// (só migrations são reaplicadas em beforeEach) — cada teste usa um ISBN
// próprio, nunca reaproveitado entre `it()` blocks, exceto quando o próprio
// teste testa dedup de propósito (aí controla as duas contas dentro do mesmo
// `it()`).
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/server/types';

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const testEnv = env as unknown as Env;
const origin = 'https://example.com';
let requestSequence = 1;

async function request(path: string, method = 'GET', body?: unknown, cookie?: string, csrf?: string) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.18.0.${requestSequence++ % 250}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string) {
  const response = await request('/auth/register', 'POST', {
    email: `${name}@example.com`, displayName: name, password: 'esta e uma senha longa 2026',
  });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies de autenticação ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

const base = {
  categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
  playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
  coverUrl: null, coverSourceUrl: null, coverSourceNote: null,
};

describe('LIB-003: identidade, ISBN, provenance e deduplicação segura', () => {
  it('User A cadastra ISBN X → Publication criada; User B cadastra o mesmo ISBN → Publication reaproveitada, entries isolados', async () => {
    const isbn = '9783161484100';
    const a = await register('lib003-dedup-a');
    const b = await register('lib003-dedup-b');

    const createdA = await request('/rpgs', 'POST', { ...base, title: 'Alien RPG (grafia de A)', isbn, wantsToPlay: true }, a.cookie, a.csrf);
    expect(createdA.status).toBe(201);
    const itemA = ((await createdA.json()) as { item: { id: string; title: string } }).item;

    const createdB = await request('/rpgs', 'POST', { ...base, title: 'Alien (grafia de B)', isbn, wantsToPlay: false, notes: 'Notas de B' }, b.cookie, b.csrf);
    expect(createdB.status).toBe(201);
    const itemB = ((await createdB.json()) as { item: { id: string; title: string } }).item;

    // Mesma Publication reaproveitada — sem duplicar o catálogo (identidade por ISBN, não título).
    const rowA = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemA.id).first<{ publication_id: string }>();
    const rowB = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemB.id).first<{ publication_id: string }>();
    expect(rowA?.publication_id).toBe(rowB?.publication_id);
    const publicationCount = await testEnv.DB.prepare('SELECT COUNT(*) total FROM publications WHERE isbn13=?').bind(isbn).first<{ total: number }>();
    expect(publicationCount?.total).toBe(1);

    // Título exibido é o da Publication já existente (a de A, primeira a cadastrar) — B não
    // sobrescreveu silenciosamente o catálogo com a própria grafia.
    expect(itemB.title).toBe('Alien RPG (grafia de A)');

    // Estados pessoais continuam isolados por conta.
    const gotA = ((await (await request(`/rpgs/${itemA.id}`, 'GET', undefined, a.cookie)).json()) as { item: { wantsToPlay: boolean; notes: string } }).item;
    const gotB = ((await (await request(`/rpgs/${itemB.id}`, 'GET', undefined, b.cookie)).json()) as { item: { wantsToPlay: boolean; notes: string } }).item;
    expect(gotA).toMatchObject({ wantsToPlay: true, notes: '' });
    expect(gotB).toMatchObject({ wantsToPlay: false, notes: 'Notas de B' });
  });

  it('User A tenta adicionar o mesmo ISBN de novo → 409 ALREADY_IN_LIBRARY, sem duplicar', async () => {
    const isbn = '0306406152'; // ISBN-10 válido (mesmo exemplo de tests/unit/isbn.test.ts)
    const a = await register('lib003-already-a');
    const first = await request('/rpgs', 'POST', { ...base, title: 'Kult: Divinity Lost', isbn }, a.cookie, a.csrf);
    expect(first.status).toBe(201);
    const again = await request('/rpgs', 'POST', { ...base, title: 'Kult (outra grafia)', isbn }, a.cookie, a.csrf);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('ALREADY_IN_LIBRARY');
    const count = await testEnv.DB.prepare('SELECT COUNT(*) total FROM rpgs WHERE user_id=?').bind(a.userId).first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it('alteração pessoal de A não afeta B (Publication compartilhada, User Library Entry isolada)', async () => {
    const isbn = '9788525406958';
    const a = await register('lib003-personal-a');
    const b = await register('lib003-personal-b');
    const createdA = await request('/rpgs', 'POST', { ...base, title: 'Tormenta20', isbn }, a.cookie, a.csrf);
    const itemA = ((await createdA.json()) as { item: { id: string } }).item;
    const createdB = await request('/rpgs', 'POST', { ...base, title: 'Tormenta 20', isbn }, b.cookie, b.csrf);
    const itemB = ((await createdB.json()) as { item: { id: string } }).item;

    const patchA = await request(`/rpgs/${itemA.id}`, 'PATCH', { ...base, title: 'Tormenta20', isbn, wantsToPlay: true, notes: 'Prioridade de A' }, a.cookie, a.csrf);
    expect(patchA.status).toBe(200);

    const gotB = ((await (await request(`/rpgs/${itemB.id}`, 'GET', undefined, b.cookie)).json()) as { item: { wantsToPlay: boolean; notes: string } }).item;
    expect(gotB).toMatchObject({ wantsToPlay: false, notes: '' });
  });

  it('sem ISBN, Publications ficam independentes mesmo com título igual (sem dedup por título)', async () => {
    const a = await register('lib003-noisbn-a');
    const b = await register('lib003-noisbn-b');
    const createdA = await request('/rpgs', 'POST', { ...base, title: 'Fanzine Caseiro', isbn: null }, a.cookie, a.csrf);
    const createdB = await request('/rpgs', 'POST', { ...base, title: 'Fanzine Caseiro', isbn: null }, b.cookie, b.csrf);
    const itemA = ((await createdA.json()) as { item: { id: string } }).item;
    const itemB = ((await createdB.json()) as { item: { id: string } }).item;
    const rowA = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemA.id).first<{ publication_id: string }>();
    const rowB = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemB.id).first<{ publication_id: string }>();
    expect(rowA?.publication_id).not.toBe(rowB?.publication_id);
  });

  it('política de metadata compartilhada: bloqueia alteração editorial quando há 2+ referências, mas nunca bloqueia estado pessoal', async () => {
    const isbn = '9788575220436';
    const a = await register('lib003-locked-a');
    const b = await register('lib003-locked-b');
    const createdA = await request('/rpgs', 'POST', { ...base, title: '3D&T Alpha', isbn }, a.cookie, a.csrf);
    const itemA = ((await createdA.json()) as { item: { id: string } }).item;
    await request('/rpgs', 'POST', { ...base, title: '3D&T Alpha', isbn }, b.cookie, b.csrf); // agora compartilhada (refCount=2)

    // Estado pessoal continua livre mesmo compartilhada.
    const personalOnly = await request(`/rpgs/${itemA.id}`, 'PATCH', { ...base, title: '3D&T Alpha', isbn, wantsToPlay: true }, a.cookie, a.csrf);
    expect(personalOnly.status).toBe(200);

    // Metadata (título) bloqueada.
    const titleChange = await request(`/rpgs/${itemA.id}`, 'PATCH', { ...base, title: '3D&T Alpha — Novo Nome', isbn, wantsToPlay: true }, a.cookie, a.csrf);
    expect(titleChange.status).toBe(422);
    const titleBody = (await titleChange.json()) as { error: { code: string; fields?: Record<string, string[]> } };
    expect(titleBody.error.code).toBe('SHARED_PUBLICATION_METADATA_LOCKED');
    expect(titleBody.error.fields?.title?.[0]).toBeTruthy();

    // Capa bloqueada também.
    const coverChange = await request(`/rpgs/${itemA.id}`, 'PATCH', { ...base, title: '3D&T Alpha', isbn, coverUrl: 'https://exemplo.com/nova-capa.jpg', wantsToPlay: true }, a.cookie, a.csrf);
    expect(coverChange.status).toBe(422);
    expect(((await coverChange.json()) as { error: { code: string } }).error.code).toBe('SHARED_PUBLICATION_METADATA_LOCKED');

    // Confirma que nada foi alterado na Publication compartilhada.
    const publication = await testEnv.DB.prepare('SELECT title,cover_url FROM publications WHERE isbn13=?').bind(isbn).first<{ title: string; cover_url: string | null }>();
    expect(publication).toMatchObject({ title: '3D&T Alpha', cover_url: null });
  });

  it('PATCH para um ISBN que já pertence a outra Publication é rejeitado (sem merge silencioso)', async () => {
    const isbnOne = '9788575220436'; const isbnTwo = '9788525406958';
    const a = await register('lib003-conflict-a');
    const first = await request('/rpgs', 'POST', { ...base, title: 'RPG Um', isbn: isbnOne }, a.cookie, a.csrf);
    await request('/rpgs', 'POST', { ...base, title: 'RPG Dois', isbn: isbnTwo }, a.cookie, a.csrf);
    const itemOne = ((await first.json()) as { item: { id: string } }).item;
    const conflict = await request(`/rpgs/${itemOne.id}`, 'PATCH', { ...base, title: 'RPG Um', isbn: isbnTwo }, a.cookie, a.csrf);
    expect(conflict.status).toBe(422);
    const body = (await conflict.json()) as { error: { code: string; fields?: Record<string, string[]> } };
    expect(body.error.fields?.isbn?.[0]).toBeTruthy();
  });

  it('ISBN inválido é rejeitado com field error claro (create e edit)', async () => {
    const a = await register('lib003-invalid-isbn');
    const created = await request('/rpgs', 'POST', { ...base, title: 'RPG Teste', isbn: '9783161484101' }, a.cookie, a.csrf);
    expect(created.status).toBe(422);
    expect(((await created.json()) as { error: { fields?: Record<string, string[]> } }).error.fields?.isbn?.[0]).toContain('ISBN inválido');

    const ok = await request('/rpgs', 'POST', { ...base, title: 'RPG Teste', isbn: null }, a.cookie, a.csrf);
    const item = ((await ok.json()) as { item: { id: string } }).item;
    const edited = await request(`/rpgs/${item.id}`, 'PATCH', { ...base, title: 'RPG Teste', isbn: '9783161484101' }, a.cookie, a.csrf);
    expect(edited.status).toBe(422);
    expect(((await edited.json()) as { error: { fields?: Record<string, string[]> } }).error.fields?.isbn?.[0]).toContain('ISBN inválido');
  });

  it('ISBN legado inválido preservado é editável sem alteração (mesmo princípio do incidente de coverUrl, LIB-001)', async () => {
    const a = await register('lib003-legacy-isbn');
    const created = await request('/rpgs', 'POST', { ...base, title: 'RPG Legado ISBN', isbn: null }, a.cookie, a.csrf);
    const item = ((await created.json()) as { item: { id: string } }).item;
    // Simula um ISBN legado inválido persistido diretamente (nenhum caso real conhecido hoje —
    // ver docs/library/PUBLICATION_IDENTITY.md — mas a proteção precisa existir).
    const row = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(item.id).first<{ publication_id: string }>();
    await testEnv.DB.prepare('UPDATE publications SET isbn=? WHERE id=?').bind('ISBN-LEGADO-INVALIDO', row!.publication_id).run();

    const got = ((await (await request(`/rpgs/${item.id}`, 'GET', undefined, a.cookie)).json()) as { item: { isbn: string } }).item;
    expect(got.isbn).toBe('ISBN-LEGADO-INVALIDO');

    // Salvar sem alterar o ISBN precisa funcionar mesmo ele sendo inválido pelo checksum atual.
    const saved = await request(`/rpgs/${item.id}`, 'PATCH', { ...base, title: 'RPG Legado ISBN', isbn: 'ISBN-LEGADO-INVALIDO', wantsToPlay: true }, a.cookie, a.csrf);
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { item: { isbn: string; wantsToPlay: boolean } }).item).toMatchObject({ isbn: 'ISBN-LEGADO-INVALIDO', wantsToPlay: true });
  });

  it('import CSV: EXISTING_PUBLICATION reaproveita a Publication (sem duplicar) e ALREADY_IN_LIBRARY não é confirmável', async () => {
    const isbn = '9788575220436';
    const owner = await register('lib003-import-owner');
    const created = await request('/rpgs', 'POST', { ...base, title: 'Old Dragon', isbn }, owner.cookie, owner.csrf);
    const ownerItem = ((await created.json()) as { item: { id: string } }).item;

    const importer = await register('lib003-import-newcomer');
    const csv = ['Sistema / Jogo,Categoria,Subgênero,Status da leitura,ISBN', `Old Dragon (outra grafia),Fantasia,Alta Fantasia,Lido,${isbn}`].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, importer.cookie, importer.csrf);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { jobId: string; items: Array<{ row: number; classification: string; resolvedPublicationId: string | null }> };
    expect(previewBody.items[0].classification).toBe('EXISTING_PUBLICATION');
    expect(previewBody.items[0].resolvedPublicationId).toBeTruthy();

    const confirm = await request('/import/confirm', 'POST', { jobId: previewBody.jobId, approvedRows: [2] }, importer.cookie, importer.csrf);
    expect(confirm.status).toBe(200);
    expect(await confirm.json()).toMatchObject({ imported: 1 });

    const publicationCount = await testEnv.DB.prepare('SELECT COUNT(*) total FROM publications WHERE isbn13=?').bind(isbn).first<{ total: number }>();
    expect(publicationCount?.total).toBe(1); // não duplicou

    const importedRow = await testEnv.DB.prepare('SELECT r.publication_id FROM rpgs r WHERE r.user_id=?').bind(importer.userId).first<{ publication_id: string }>();
    const ownerRow = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(ownerItem.id).first<{ publication_id: string }>();
    expect(importedRow?.publication_id).toBe(ownerRow?.publication_id);

    // Reimportar a mesma linha agora classifica ALREADY_IN_LIBRARY, não selecionável.
    const secondPreview = await request('/import/preview', 'POST', { csv }, importer.cookie, importer.csrf);
    const secondBody = (await secondPreview.json()) as { items: Array<{ classification: string }>; canConfirm: boolean };
    expect(secondBody.items[0].classification).toBe('ALREADY_IN_LIBRARY');
    expect(secondBody.canConfirm).toBe(false);
  });

  it('segurança: User A não lê nem altera User Library Entry de B, mesmo com Publication compartilhada (sem IDOR)', async () => {
    const isbn = '9788525406958';
    const a = await register('lib003-idor-a');
    const b = await register('lib003-idor-b');
    await request('/rpgs', 'POST', { ...base, title: 'Vampiro', isbn }, a.cookie, a.csrf);
    const createdB = await request('/rpgs', 'POST', { ...base, title: 'Vampiro', isbn, notes: 'Segredo de B' }, b.cookie, b.csrf);
    const itemB = ((await createdB.json()) as { item: { id: string } }).item;

    // A não lê o RPG de B (mesmo a Publication sendo compartilhada — o que é compartilhado é só
    // metadata de catálogo, nunca o User Library Entry).
    expect((await request(`/rpgs/${itemB.id}`, 'GET', undefined, a.cookie)).status).toBe(404);
    // A não altera o RPG de B.
    expect((await request(`/rpgs/${itemB.id}`, 'PATCH', { ...base, title: 'Vampiro', isbn, notes: 'Sequestrado por A' }, a.cookie, a.csrf)).status).toBe(404);
    // Notas de B continuam intactas.
    const gotB = ((await (await request(`/rpgs/${itemB.id}`, 'GET', undefined, b.cookie)).json()) as { item: { notes: string } }).item;
    expect(gotB.notes).toBe('Segredo de B');
  });

  it('publication_external_ids: schema pronto, tabela vazia (nenhum provider chamado nesta tarefa)', async () => {
    const count = await testEnv.DB.prepare('SELECT COUNT(*) total FROM publication_external_ids').first<{ total: number }>();
    expect(count?.total).toBe(0);
  });
});
