// LIB-007: hardening de import/export da Biblioteca — ver
// docs/library/LIBRARY_IMPORT_EXPORT.md. Arquivo separado por escopo, mesmo
// padrão de isolamento dos demais arquivos de tests/integration.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const origin = 'https://example.com';
let requestSequence = 1;

async function request(path: string, method = 'GET', body?: unknown, cookie?: string, csrf?: string) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `198.18.4.${requestSequence++ % 250}`,
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
  return ((await created.json()) as { item: { id: string } }).item;
}

describe('LIB-007: ISBN duplicado dentro do mesmo CSV', () => {
  it('duas linhas com o mesmo ISBN (nenhuma pré-existente) são sinalizadas — nunca as duas juntas causam falha no confirm', async () => {
    const isbn = '9783100000002';
    const a = await register('lib007-dup-isbn-a');
    const csv = [
      'Sistema / Jogo,Categoria,Subgênero,Status da Leitura,ISBN',
      `"RPG Duplicado A",Fantasia,Alta Fantasia,Não iniciado,${isbn}`,
      `"RPG Duplicado B (mesmo ISBN)",Fantasia,Alta Fantasia,Não iniciado,${isbn}`,
    ].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, a.cookie, a.csrf);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { items: Array<{ row: number; classification: string; message: string }> };
    // Ao menos uma das duas linhas precisa vir marcada como ERRO/duplicada — nunca as duas como
    // NOVO simultaneamente (isso faria o /import/confirm tentar inserir o mesmo ISBN duas vezes
    // no mesmo batch, violando o índice único de publications.isbn13 e derrubando a transação
    // inteira, inclusive a primeira linha, que seria válida sozinha).
    const novoCount = body.items.filter((item) => item.classification === 'NOVO').length;
    expect(novoCount).toBeLessThanOrEqual(1);
  });
});

describe('LIB-007: BOM UTF-8 no início do CSV', () => {
  it('CSV com BOM UTF-8 continua reconhecendo os headers normalmente', async () => {
    const a = await register('lib007-bom-a');
    const csv = '﻿' + [
      'Sistema / Jogo,Categoria,Subgênero,Status da Leitura',
      'RPG Com BOM,Fantasia,Alta Fantasia,Não iniciado',
    ].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, a.cookie, a.csrf);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { items: Array<{ classification: string }> };
    expect(body.items[0]?.classification).toBe('NOVO');
  });
});

describe('LIB-007: export CSV neutraliza spreadsheet formula injection', () => {
  it('um valor de campo começando com =, +, -, @ nunca é exportado como fórmula executável', async () => {
    const a = await register('lib007-formula-a');
    await createRpg('=cmd|\'/c calc\'!A1', a.cookie, a.csrf, { notes: '+SUM(1+1)' });
    const exported = await request('/export?format=csv', 'GET', undefined, a.cookie);
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    const lines = csv.split('\n');
    const dataLine = lines.find((line) => line.includes('cmd'));
    expect(dataLine).toBeTruthy();
    // O campo precisa estar neutralizado (nunca começar literalmente por =, +, -, @ depois de
    // aberto pelo Excel/Sheets) — aceita tanto aspas quanto o apóstrofo líder de neutralização.
    const titleCell = dataLine!.split(',')[0];
    expect(/^[="'']/u.test(titleCell)).toBe(true);
    expect(titleCell.replace(/^"/u, '').startsWith('=cmd')).toBe(false);
  });
});

describe('LIB-007: multi-tenant / IDOR em import job', () => {
  it('User B não consegue confirmar um import job de User A', async () => {
    const a = await register('lib007-idor-a');
    const b = await register('lib007-idor-b');
    const csv = ['Sistema / Jogo,Categoria,Subgênero,Status da Leitura', 'RPG de A,Fantasia,Alta Fantasia,Não iniciado'].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, a.cookie, a.csrf);
    const jobId = ((await preview.json()) as { jobId: string }).jobId;

    const confirmByB = await request('/import/confirm', 'POST', { jobId, approvedRows: [2] }, b.cookie, b.csrf);
    expect(confirmByB.status).toBe(404);

    // Nada foi criado na conta de B.
    const bLibrary = await request('/rpgs', 'GET', undefined, b.cookie);
    expect(((await bLibrary.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('estado pessoal de User A nunca vaza para User B ao reaproveitar a mesma Publication (EXISTING_PUBLICATION)', async () => {
    const isbn = '9783200000001';
    const a = await register('lib007-personal-a');
    await createRpg('RPG Compartilhado', a.cookie, a.csrf, { isbn, notes: 'Segredo pessoal de A', wantsToPlay: true });

    const b = await register('lib007-personal-b');
    const csv = ['Sistema / Jogo,Categoria,Subgênero,Status da Leitura,ISBN', `"RPG Compartilhado (grafia de B)",Fantasia,Alta Fantasia,Não iniciado,${isbn}`].join('\n');
    const preview = await request('/import/preview', 'POST', { csv }, b.cookie, b.csrf);
    const previewBody = (await preview.json()) as { jobId: string; items: Array<{ classification: string }> };
    expect(previewBody.items[0].classification).toBe('EXISTING_PUBLICATION');
    const confirm = await request('/import/confirm', 'POST', { jobId: previewBody.jobId, approvedRows: [2] }, b.cookie, b.csrf);
    expect(confirm.status).toBe(200);

    const bItem = ((await (await request('/rpgs', 'GET', undefined, b.cookie)).json()) as { items: Array<{ notes: string; wantsToPlay: boolean }> }).items[0];
    expect(bItem.notes).toBe(''); // nunca herda a nota pessoal de A.
    expect(bItem.wantsToPlay).toBe(false);
  });
});

describe('LIB-007: export/backup completo (JSON) — round-trip e cobertura', () => {
  it('backup preserva Publication identity, archived_at, coverUrl e coverAssetId (referência)', async () => {
    const a = await register('lib007-backup-a');
    const item = await createRpg('RPG Backup Completo', a.cookie, a.csrf, {
      isbn: '9783400000009', coverUrl: 'https://exemplo.com/capa-backup.jpg',
    });
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const formData = new FormData();
    formData.set('cover', new Blob([jpegBytes]), 'cover.jpg');
    const uploaded = await worker.default.fetch(`${origin}/api/v1/rpgs/${item.id}/cover`, {
      method: 'POST', headers: { 'CF-Connecting-IP': '198.18.4.200', Origin: origin, Cookie: a.cookie, 'X-CSRF-Token': a.csrf }, body: formData,
    });
    const assetId = ((await uploaded.json()) as { item: { coverAssetId: string | null } }).item.coverAssetId;
    await request(`/rpgs/${item.id}/archive`, 'POST', {}, a.cookie, a.csrf);

    const exported = await request('/export', 'GET', undefined, a.cookie);
    expect(exported.status).toBe(200);
    const body = (await exported.json()) as {
      data: {
        rpgs: Array<{ id: string; archived_at: string | null; publication_id: string }>;
        publications: Array<{ id: string; isbn13: string; cover_url: string | null; cover_asset_id: string | null }>;
        gameSystems: Array<{ id: string }>;
      };
    };
    const rpgRow = body.data.rpgs.find((r) => r.id === item.id);
    expect(rpgRow?.archived_at).toBeTruthy();
    const publicationRow = body.data.publications.find((p) => p.id === rpgRow?.publication_id);
    expect(publicationRow).toMatchObject({ isbn13: '9783400000009', cover_url: 'https://exemplo.com/capa-backup.jpg', cover_asset_id: assetId });
    expect(body.data.gameSystems.length).toBeGreaterThan(0);
  });
});
