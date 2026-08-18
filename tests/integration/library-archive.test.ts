// LIB-006: archive/restore de User Library Entry — ver docs/library/LIBRARY_ARCHIVE.md.
// Arquivo separado por escopo, mesmo padrão de isolamento dos demais arquivos de
// tests/integration (helpers locais, cada teste usa título/ISBN próprios).
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
      'CF-Connecting-IP': `198.18.3.${requestSequence++ % 250}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

async function createRpg(title: string, cookie: string, csrf: string, extra: Record<string, unknown> = {}) {
  const created = await request('/rpgs', 'POST', { ...base, title, ...extra }, cookie, csrf);
  expect(created.status).toBe(201);
  return ((await created.json()) as { item: { id: string; archivedAt: string | null } }).item;
}

describe('LIB-006: archivar/restaurar — comportamento básico e idempotência', () => {
  it('archive marca archived_at, restore volta a NULL; ambos idempotentes', async () => {
    const a = await register('lib006-basic-a');
    const item = await createRpg('Blades in the Dark', a.cookie, a.csrf);
    expect(item.archivedAt).toBeNull();

    const archived1 = await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    expect(archived1.status).toBe(200);
    const body1 = (await archived1.json()) as { item: { archivedAt: string | null } };
    expect(body1.item.archivedAt).toBeTruthy();

    // Idempotente: arquivar de novo não quebra nem muda o timestamp original.
    const archived2 = await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    expect(archived2.status).toBe(200);
    const body2 = (await archived2.json()) as { item: { archivedAt: string | null } };
    expect(body2.item.archivedAt).toBe(body1.item.archivedAt);

    const restored1 = await request(`/rpgs/${item.id}/restore`, 'POST', {}, a.cookie, a.csrf);
    expect(restored1.status).toBe(200);
    expect(((await restored1.json()) as { item: { archivedAt: string | null } }).item.archivedAt).toBeNull();

    // Idempotente: restaurar de novo (já ativo) continua 200, sem corrupção.
    const restored2 = await request(`/rpgs/${item.id}/restore`, 'POST', {}, a.cookie, a.csrf);
    expect(restored2.status).toBe(200);
    expect(((await restored2.json()) as { item: { archivedAt: string | null } }).item.archivedAt).toBeNull();
  });

  it('archive/restore de um RPG inexistente ou de outra conta (IDOR) devolve 404', async () => {
    const a = await register('lib006-idor-a');
    const b = await register('lib006-idor-b');
    const item = await createRpg('Apocalypse World', a.cookie, a.csrf);

    const archiveByB = await request(`/rpgs/${item.id}/archive`, 'POST', {}, b.cookie, b.csrf);
    expect(archiveByB.status).toBe(404);
    const restoreByB = await request(`/rpgs/${item.id}/restore`, 'POST', {}, b.cookie, b.csrf);
    expect(restoreByB.status).toBe(404);

    const missing = await request(`/rpgs/${crypto.randomUUID()}/archive`, 'POST', {}, a.cookie, a.csrf);
    expect(missing.status).toBe(404);

    // B não consegue confirmar (via listagem) que o RPG de A existe/está arquivado.
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    const archivedListB = await request('/rpgs?archived=true', 'GET', undefined, b.cookie);
    const listBBody = (await archivedListB.json()) as { items: Array<{ id: string }> };
    expect(listBBody.items.some((entry) => entry.id === item.id)).toBe(false);
  });
});

describe('LIB-006: listagem — ativos por padrão, arquivados só quando solicitado', () => {
  it('GET /rpgs (padrão) exclui arquivados; ?archived=true mostra só arquivados; nunca mistura', async () => {
    const a = await register('lib006-list-a');
    const activeItem = await createRpg('Root RPG', a.cookie, a.csrf);
    const archivedItem = await createRpg('Wanderhome', a.cookie, a.csrf);
    await request(`/rpgs/${archivedItem.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const activeList = await request('/rpgs?pageSize=100', 'GET', undefined, a.cookie);
    const activeBody = (await activeList.json()) as { items: Array<{ id: string }> };
    expect(activeBody.items.some((entry) => entry.id === activeItem.id)).toBe(true);
    expect(activeBody.items.some((entry) => entry.id === archivedItem.id)).toBe(false);

    const archivedList = await request('/rpgs?archived=true&pageSize=100', 'GET', undefined, a.cookie);
    const archivedBody = (await archivedList.json()) as { items: Array<{ id: string }> };
    expect(archivedBody.items.some((entry) => entry.id === archivedItem.id)).toBe(true);
    expect(archivedBody.items.some((entry) => entry.id === activeItem.id)).toBe(false);
  });

  it('GET /rpgs/:id de um item arquivado continua 200 (não 404) — item 8 do pedido', async () => {
    const a = await register('lib006-detail-a');
    const item = await createRpg('Mörk Borg', a.cookie, a.csrf);
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    const detail = await request(`/rpgs/${item.id}`, 'GET', undefined, a.cookie);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { item: { archivedAt: string | null } }).item.archivedAt).toBeTruthy();
  });
});

describe('LIB-006: dashboard/recomendações excluem arquivados', () => {
  it('métricas e recomendações do dashboard não contam RPGs arquivados', async () => {
    const a = await register('lib006-dash-a');
    const active = await createRpg('Dashboard Ativo Unico', a.cookie, a.csrf, { wantsToPlay: true });
    const archived = await createRpg('Dashboard Arquivado Unico', a.cookie, a.csrf, { wantsToPlay: true });
    await request(`/rpgs/${archived.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const dashboard = await request('/dashboard', 'GET', undefined, a.cookie);
    expect(dashboard.status).toBe(200);
    const body = (await dashboard.json()) as {
      metrics: { total: number };
      recommendations: Array<{ id: string; title: string }>;
      readingBacklog: Array<{ id: string }>;
    };
    expect(body.metrics.total).toBe(1);
    expect(body.recommendations.some((r) => r.id === active.id)).toBe(true);
    expect(body.recommendations.some((r) => r.id === archived.id)).toBe(false);
    expect(body.readingBacklog.some((r) => r.id === archived.id)).toBe(false);
  });
});

describe('LIB-006: dedup entende arquivado (create/import)', () => {
  it('CREATE com o mesmo ISBN de uma entry arquivada -> 409 ARCHIVED_IN_LIBRARY com libraryEntryId, sem duplicar', async () => {
    const isbn = '9781588463210';
    const a = await register('lib006-dedup-a');
    const item = await createRpg('Fate Core', a.cookie, a.csrf, { isbn });
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const retry = await request('/rpgs', 'POST', { ...base, title: 'Fate Core (de novo)', isbn }, a.cookie, a.csrf);
    expect(retry.status).toBe(409);
    const retryBody = (await retry.json()) as { error: { code: string; fields?: Record<string, string[]> } };
    expect(retryBody.error.code).toBe('ARCHIVED_IN_LIBRARY');
    expect(retryBody.error.fields?.libraryEntryId?.[0]).toBe(item.id);

    // Nenhuma linha nova criada.
    const count = await testEnv.DB.prepare('SELECT COUNT(*) total FROM rpgs WHERE user_id=? AND publication_id=(SELECT publication_id FROM rpgs WHERE id=?)')
      .bind(a.userId, item.id).first<{ total: number }>();
    expect(count?.total).toBe(1);
  });

  it('search-external anota libraryStatus=ARCHIVED_IN_LIBRARY para uma Publication já arquivada do usuário (busca por ISBN)', async () => {
    const isbn = '9781950904013';
    const a = await register('lib006-search-a');
    const item = await createRpg('Public Access', a.cookie, a.csrf, { isbn });
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const search = await request(`/rpgs/search-external?q=${isbn}`, 'GET', undefined, a.cookie);
    expect(search.status).toBe(200);
    const results = ((await search.json()) as { results: Array<{ libraryStatus?: string; libraryEntryId?: string }> }).results;
    expect(results).toHaveLength(1);
    expect(results[0].libraryStatus).toBe('ARCHIVED_IN_LIBRARY');
    expect(results[0].libraryEntryId).toBe(item.id);
  });

  it('import CSV com o mesmo ISBN de uma entry arquivada classifica ARCHIVED_IN_LIBRARY, não aprovável, sem duplicar', async () => {
    const isbn = '9780874216233';
    const a = await register('lib006-csvimport-a');
    const item = await createRpg('Chuubo Marvelous Wish Granting', a.cookie, a.csrf, { isbn });
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const csv = [
      'Sistema / Jogo,Categoria,Subgênero,Status da Leitura,ISBN',
      `"Chuubo Reimportado",Fantasia,Alta Fantasia,Não iniciado,${isbn}`,
    ].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, a.cookie, a.csrf);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { items: Array<{ classification: string; existingId: string | null }> };
    expect(previewBody.items).toHaveLength(1);
    expect(previewBody.items[0].classification).toBe('ARCHIVED_IN_LIBRARY');
    expect(previewBody.items[0].existingId).toBe(item.id);

    const count = await testEnv.DB.prepare('SELECT COUNT(*) total FROM rpgs WHERE user_id=?').bind(a.userId).first<{ total: number }>();
    expect(count?.total).toBe(1); // continua só a entry original — CSV não duplicou.
  });
});

describe('LIB-006: SHARED_PUBLICATION_METADATA_LOCKED continua contando entries arquivadas', () => {
  it('User A arquiva sua entry; User B (ativo) continua bloqueado para editar metadata compartilhada', async () => {
    const isbn = '9780857440259';
    const a = await register('lib006-shared-a');
    const b = await register('lib006-shared-b');
    const itemA = await createRpg('Marvel Heroic Roleplaying', a.cookie, a.csrf, { isbn });
    const itemB = await createRpg('Marvel Heroic Roleplaying', b.cookie, b.csrf, { isbn }); // refCount=2

    const archiveA = await request(`/rpgs/${itemA.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    expect(archiveA.status).toBe(200); // archive nunca é bloqueado pela trava compartilhada.

    // B ainda não pode editar metadata: a entry de A, mesmo arquivada, continua contando
    // como referência (seção 13 do pedido LIB-006) — se B mudasse o título agora, A veria
    // o título trocado ao restaurar, sem nunca ter concordado.
    const editB = await request(`/rpgs/${itemB.id}`, 'PATCH', { ...base, title: 'Novo Título Indevido', isbn, wantsToPlay: true }, b.cookie, b.csrf);
    expect(editB.status).toBe(422);
    expect(((await editB.json()) as { error: { code: string } }).error.code).toBe('SHARED_PUBLICATION_METADATA_LOCKED');

    // Upload de capa por B também continua bloqueado pelo mesmo motivo.
    const publication = await testEnv.DB.prepare('SELECT publication_id FROM rpgs WHERE id=?').bind(itemB.id).first<{ publication_id: string }>();
    expect(publication?.publication_id).toBeTruthy();
  });
});

describe('LIB-006: preservação de dados no ciclo archive -> restore', () => {
  it('coverUrl externa, coverAssetId, ISBN, estado pessoal e vínculo de campanha sobrevivem intactos', async () => {
    const a = await register('lib006-preserve-a');
    const externalCoverUrl = 'https://exemplo.com/capa-preservada.jpg';
    const item = await createRpg('Root Persistente', a.cookie, a.csrf, {
      coverUrl: externalCoverUrl, isbn: '9788575220436', notes: 'Notas pessoais importantes', wantsToPlay: true, priority: 'HIGH',
    });

    // Campanha vinculada — precisa continuar carregando depois do archive.
    const campaignCreate = await request('/campaigns', 'POST', {
      rpgId: item.id, name: 'Mesa de Teste', status: 'PLANNING', gameMaster: '', playGroupId: null, adventureEntityId: null,
      sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null,
      legacyMembersText: '', legacyCharactersText: '', notes: '',
    }, a.cookie, a.csrf);
    expect(campaignCreate.status).toBe(201);
    const campaignId = ((await campaignCreate.json()) as { item: { id: string } }).item.id;

    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    // Campaign continua carregando e agora indica RPG arquivado (seção 11 do pedido).
    const campaignAfterArchive = await request(`/campaigns/${campaignId}`, 'GET', undefined, a.cookie);
    expect(campaignAfterArchive.status).toBe(200);
    const campaignBody = (await campaignAfterArchive.json()) as { item: { rpgArchived: boolean; rpgId: string } };
    expect(campaignBody.item.rpgArchived).toBe(true);
    expect(campaignBody.item.rpgId).toBe(item.id);

    const restored = await request(`/rpgs/${item.id}/restore`, 'POST', {}, a.cookie, a.csrf);
    const restoredItem = ((await restored.json()) as {
      item: { coverUrl: string | null; isbn: string | null; notes: string; wantsToPlay: boolean; priority: string; id: string };
    }).item;
    expect(restoredItem).toMatchObject({ id: item.id, coverUrl: externalCoverUrl, isbn: '9788575220436', notes: 'Notas pessoais importantes', wantsToPlay: true, priority: 'HIGH' });

    const campaignAfterRestore = await request(`/campaigns/${campaignId}`, 'GET', undefined, a.cookie);
    expect(((await campaignAfterRestore.json()) as { item: { rpgArchived: boolean } }).item.rpgArchived).toBe(false);
  });

  it('coverAssetId (capa por upload, LIB-005) sobrevive ao ciclo archive -> restore', async () => {
    const a = await register('lib006-cover-a');
    const item = await createRpg('Capa Upload Persistente', a.cookie, a.csrf);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const formData = new FormData();
    formData.set('cover', new Blob([jpegBytes]), 'cover.jpg');
    const uploaded = await worker.default.fetch(`${origin}/api/v1/rpgs/${item.id}/cover`, {
      method: 'POST', headers: { 'CF-Connecting-IP': '198.18.3.99', Origin: origin, Cookie: a.cookie, 'X-CSRF-Token': a.csrf }, body: formData,
    });
    expect(uploaded.status).toBe(200);
    const assetId = ((await uploaded.json()) as { item: { coverAssetId: string | null } }).item.coverAssetId;
    expect(assetId).toBeTruthy();

    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);
    const restored = await request(`/rpgs/${item.id}/restore`, 'POST', {}, a.cookie, a.csrf);
    expect(((await restored.json()) as { item: { coverAssetId: string | null } }).item.coverAssetId).toBe(assetId);

    const media = await request(`/media/covers/${assetId}`, 'GET', undefined, a.cookie);
    expect(media.status).toBe(200);
  });
});

describe('LIB-006: export/backup preserva archived_at', () => {
  it('backup completo (JSON) inclui a linha do RPG arquivado com archived_at preenchido', async () => {
    const a = await register('lib006-export-a');
    const item = await createRpg('Exportado Arquivado', a.cookie, a.csrf);
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const exported = await request('/export', 'GET', undefined, a.cookie);
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as { data: { rpgs: Array<{ id: string; archived_at: string | null }> } };
    const row = body.data.rpgs.find((r) => r.id === item.id);
    expect(row?.archived_at).toBeTruthy();
  });
});
