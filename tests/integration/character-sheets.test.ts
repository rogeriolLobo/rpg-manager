// F-020 (BATCH9): Character Sheet Engine base — ver src/server/routes/sheets.ts.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://sheets.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.119.${requestSequence++ % 250}`,
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
  entityType: 'CHARACTER', name, summary: '', description: '', visibility: 'PRIVATE',
  worldId: null, groupId: null, parentEntityId: null, adventure: null, ...extra,
});

const template = (extra: Record<string, unknown> = {}) => ({
  name: 'Ficha Neutra', description: '', worldId: null,
  fields: [
    { key: 'conceito', label: 'Conceito', type: 'TEXT', required: true },
    { key: 'recursos', label: 'Recursos', type: 'NUMBER', required: true },
    { key: 'postura', label: 'Postura', type: 'CHOICE', required: true, options: ['CAUTELOSA', 'OUSADA'] },
  ],
  ...extra,
});

async function createEntity(account: Account, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request('/vault', 'POST', entity('Personagem', extra), account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

async function createTemplate(account: Account, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await request('/sheets/templates', 'POST', template(extra), account);
  expect(response.status).toBe(201);
  return (await response.json() as { id: string }).id;
}

describe('Character Sheet Engine (F-020)', () => {
  it('cria modelo global, vincula ficha a Personagem e valida os valores contra o modelo', async () => {
    const owner = await register('sheet-owner');
    const templateId = await createTemplate(owner);
    const entityId = await createEntity(owner);

    const invalid = await request(`/sheets/entities/${entityId}`, 'PUT', { templateId, values: { conceito: '', recursos: '3', postura: 'DESCONHECIDA' } }, owner);
    expect(invalid.status).toBe(422);
    const invalidBody = await invalid.json() as { error: { code: string; fields: Record<string, string[]> } };
    expect(invalidBody.error.code).toBe('INVALID_SHEET_VALUES');
    expect(invalidBody.error.fields).toEqual({ conceito: ['Campo obrigatório.'], recursos: ['Informe um número.'], postura: ['Opção inválida.'] });

    const valid = await request(`/sheets/entities/${entityId}`, 'PUT', { templateId, values: { conceito: 'Cartógrafa', recursos: 3, postura: 'OUSADA' } }, owner);
    expect(valid.status).toBe(200);

    const read = await request(`/sheets/entities/${entityId}`, 'GET', undefined, owner);
    const body = await read.json() as { item: { templateId: string; values: Record<string, unknown>; outdated: boolean } };
    expect(body.item.templateId).toBe(templateId);
    expect(body.item.values).toEqual({ conceito: 'Cartógrafa', recursos: 3, postura: 'OUSADA' });
    expect(body.item.outdated).toBe(false);
  });

  it('recusa vincular ficha a entidade que não é Personagem/NPC e IDOR entre donos', async () => {
    const owner = await register('sheet-owner-2');
    const outsider = await register('sheet-outsider-2');
    const templateId = await createTemplate(owner);

    const locationResponse = await request('/vault', 'POST', entity('Local', { entityType: 'LOCATION' }), owner);
    expect(locationResponse.status).toBe(201);
    const locationId = (await locationResponse.json() as { id: string }).id;
    expect((await request(`/sheets/entities/${locationId}`, 'PUT', { templateId, values: {} }, owner)).status).toBe(422);

    const entityId = await createEntity(owner);
    // Entidade PRIVATE de outro dono: nunca 403, sempre 404 (sem vazar existência).
    expect((await request(`/sheets/entities/${entityId}`, 'GET', undefined, outsider)).status).toBe(404);
    expect((await request(`/sheets/entities/${entityId}`, 'PUT', { templateId, values: { conceito: 'x', recursos: 1, postura: 'OUSADA' } }, outsider)).status).toBe(404);

    // Modelo de outro dono também nunca é aceito, mesmo para o dono da entidade.
    const otherTemplateId = await createTemplate(outsider);
    expect((await request(`/sheets/entities/${entityId}`, 'PUT', { templateId: otherTemplateId, values: {} }, owner)).status).toBe(422);
  });

  it('modelo escopado a um World só pode ser usado por entidades do mesmo World', async () => {
    const owner = await register('sheet-owner-3');
    const worldA = await request('/worlds', 'POST', { name: 'World A', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldB = await request('/worlds', 'POST', { name: 'World B', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldAId = (await worldA.json() as { item: { id: string } }).item.id;
    const worldBId = (await worldB.json() as { item: { id: string } }).item.id;

    const templateId = await createTemplate(owner, { worldId: worldAId });
    const entityInWorldB = await createEntity(owner, { worldId: worldBId });
    const entityWithoutWorld = await createEntity(owner);
    const entityInWorldA = await createEntity(owner, { worldId: worldAId });

    const values = { conceito: 'x', recursos: 1, postura: 'OUSADA' };
    expect((await request(`/sheets/entities/${entityInWorldB}`, 'PUT', { templateId, values }, owner)).status).toBe(422);
    expect((await request(`/sheets/entities/${entityWithoutWorld}`, 'PUT', { templateId, values }, owner)).status).toBe(422);
    expect((await request(`/sheets/entities/${entityInWorldA}`, 'PUT', { templateId, values }, owner)).status).toBe(200);
  });

  it('bloqueia excluir/alterar campos de modelo em uso e versiona o modelo quando os campos mudam', async () => {
    const owner = await register('sheet-owner-4');
    const templateId = await createTemplate(owner);
    const entityId = await createEntity(owner);
    await request(`/sheets/entities/${entityId}`, 'PUT', { templateId, values: { conceito: 'x', recursos: 1, postura: 'OUSADA' } }, owner);

    // Remover um campo com valor em uso é bloqueado.
    const strippedFields = template().fields.filter((field: { key: string }) => field.key !== 'postura');
    expect((await request(`/sheets/templates/${templateId}`, 'PATCH', template({ fields: strippedFields }), owner)).status).toBe(409);
    expect((await request(`/sheets/templates/${templateId}`, 'DELETE', undefined, owner)).status).toBe(409);

    // Alterar (sem remover campos em uso) incrementa a versão do modelo; a ficha mantém a versão antiga.
    const renamedFields = template().fields.map((field: { key: string; label: string }) => field.key === 'conceito' ? { ...field, label: 'Ideia central' } : field);
    const patch = await request(`/sheets/templates/${templateId}`, 'PATCH', template({ fields: renamedFields }), owner);
    expect(patch.status).toBe(200);
    expect((await patch.json() as { version: number }).version).toBe(2);

    const read = await request(`/sheets/entities/${entityId}`, 'GET', undefined, owner);
    const body = await read.json() as { item: { templateVersion: number; currentTemplateVersion: number; outdated: boolean } };
    expect(body.item).toMatchObject({ templateVersion: 1, currentTemplateVersion: 2, outdated: true });
  });

  it('desvincula a ficha (DELETE) sem afetar a entidade', async () => {
    const owner = await register('sheet-owner-5');
    const templateId = await createTemplate(owner);
    const entityId = await createEntity(owner);
    await request(`/sheets/entities/${entityId}`, 'PUT', { templateId, values: { conceito: 'x', recursos: 1, postura: 'OUSADA' } }, owner);

    expect((await request(`/sheets/entities/${entityId}`, 'DELETE', undefined, owner)).status).toBe(204);
    const read = await request(`/sheets/entities/${entityId}`, 'GET', undefined, owner);
    expect(await read.json()).toEqual({ item: null });
    // A entidade em si continua existindo.
    expect((await request(`/vault/${entityId}`, 'GET', undefined, owner)).status).toBe(200);
  });
});
