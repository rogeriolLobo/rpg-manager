// F-026 (BATCH14): Conteúdo oficial/licenciado — proveniência de uma Vault Entity, sem
// nunca copiar/redistribuir texto protegido — ver src/server/routes/vault.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://vault-provenance.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.123.${requestSequence++ % 250}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { Origin: origin } : {}),
      ...(account ? { Cookie: account.cookie, 'X-CSRF-Token': account.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function register(name: string): Promise<Account> {
  const response = await request('/auth/register', 'POST', { email: `${name}@example.com`, displayName: name, password });
  expect(response.status).toBe(201);
  const cookies = response.headers.get('set-cookie') ?? '';
  const session = cookies.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = cookies.match(/rpg_csrf=([^;,]+)/)?.[1];
  const body = await response.json() as { user: { id: string } };
  if (!session || !csrf) throw new Error('Cookies ausentes.');
  return { userId: body.user.id, cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}

const entity = (name: string, extra: Record<string, unknown> = {}) => ({
  entityType: 'LORE', name, summary: '', description: 'texto original', visibility: 'PRIVATE',
  worldId: null, groupId: null, parentEntityId: null, adventure: null,
  lore: { loreType: 'CUSTOM', canonStatus: 'DRAFT', source: '' }, ...extra,
});

describe('Vault — proveniência de conteúdo oficial/licenciado (F-026)', () => {
  it('default é USER_CREATED (sem restrição); aceita LICENSED/OFFICIAL_REFERENCE com publisher/edition/nota', async () => {
    const owner = await register('prov-owner');

    const defaultResponse = await request('/vault', 'POST', entity('Padrão'), owner);
    expect(defaultResponse.status).toBe(201);
    const defaultId = (await defaultResponse.json() as { id: string }).id;
    const defaultBody = await (await request(`/vault/${defaultId}`, 'GET', undefined, owner)).json() as { item: { contentSource: string; contentLocked: boolean } };
    expect(defaultBody.item).toMatchObject({ contentSource: 'USER_CREATED', contentLocked: false });

    const licensedResponse = await request('/vault', 'POST', entity('Licenciado', { contentSource: 'LICENSED', publisher: 'Editora X', edition: '2ª edição', licenseNote: 'Comprei o PDF oficial.' }), owner);
    expect(licensedResponse.status).toBe(201);
    const licensedId = (await licensedResponse.json() as { id: string }).id;
    const licensedBody = await (await request(`/vault/${licensedId}`, 'GET', undefined, owner)).json() as { item: { contentSource: string; publisher: string; edition: string; licenseNote: string } };
    expect(licensedBody.item).toMatchObject({ contentSource: 'LICENSED', publisher: 'Editora X', edition: '2ª edição', licenseNote: 'Comprei o PDF oficial.' });
  });

  it('content_locked bloqueia alterar a descrição até destravar; outros campos continuam editáveis; destravar+editar na mesma chamada funciona', async () => {
    const owner = await register('prov-owner-2');
    const created = await request('/vault', 'POST', entity('Trava', { contentSource: 'OFFICIAL_REFERENCE', contentLocked: true }), owner);
    const id = (await created.json() as { id: string }).id;

    // Alterar só o nome (mantendo a descrição igual) continua funcionando com o conteúdo travado.
    const renamed = await request(`/vault/${id}`, 'PATCH', entity('Trava renomeada', { contentSource: 'OFFICIAL_REFERENCE', contentLocked: true }), owner);
    expect(renamed.status).toBe(200);

    // Tentar mudar a descrição com o conteúdo ainda travado é rejeitado.
    const blocked = await request(`/vault/${id}`, 'PATCH', entity('Trava renomeada', { description: 'tentativa de alterar', contentSource: 'OFFICIAL_REFERENCE', contentLocked: true }), owner);
    expect(blocked.status).toBe(409);

    // Destravar e editar a descrição na MESMA chamada funciona.
    const unlocked = await request(`/vault/${id}`, 'PATCH', entity('Trava renomeada', { description: 'agora pode', contentSource: 'OFFICIAL_REFERENCE', contentLocked: false }), owner);
    expect(unlocked.status).toBe(200);
    const body = await (await request(`/vault/${id}`, 'GET', undefined, owner)).json() as { item: { description: string; contentLocked: boolean } };
    expect(body.item).toMatchObject({ description: 'agora pode', contentLocked: false });
  });

  it('fork preserva a proveniência (origem/publisher/edition/nota) mas nunca herda contentLocked', async () => {
    const owner = await register('prov-owner-3');
    const created = await request('/vault', 'POST', entity('Original', { contentSource: 'LICENSED', publisher: 'Editora Y', edition: '1ª', licenseNote: 'Nota', contentLocked: true }), owner);
    const originalId = (await created.json() as { id: string }).id;

    const forked = await request(`/vault/${originalId}/fork`, 'POST', {}, owner);
    expect(forked.status).toBe(201);
    const forkId = (await forked.json() as { id: string }).id;
    const forkBody = await (await request(`/vault/${forkId}`, 'GET', undefined, owner)).json() as { item: { contentSource: string; publisher: string; contentLocked: boolean } };
    expect(forkBody.item).toMatchObject({ contentSource: 'LICENSED', publisher: 'Editora Y', contentLocked: false });

    // A cópia (destravada) pode ter a descrição editada livremente.
    const editFork = await request(`/vault/${forkId}`, 'PATCH', entity('Original (cópia)', { description: 'edição livre na cópia', contentSource: 'LICENSED', publisher: 'Editora Y', edition: '1ª', licenseNote: 'Nota', contentLocked: false }), owner);
    expect(editFork.status).toBe(200);
  });
});
