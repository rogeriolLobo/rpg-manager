// F-015: Backup/Restore completo. Escopo v1 do restore automatizado: Worlds,
// Creature Stat Templates, Vault entities (+ campos especializados), Journal
// (pastas+páginas) — ver docs/product/RPG_MANAGER_FINAL_STATUS.md, seção
// F-015, e src/server/routes/backup-restore.ts para o raciocínio completo.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://backup.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.116.${requestSequence++ % 250}`,
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

async function createWorld(account: Account, name: string): Promise<string> {
  const response = await request('/worlds', 'POST', { name, description: 'mundo original', defaultRpgId: null, visibility: 'PRIVATE' }, account);
  expect(response.status).toBe(201);
  return ((await response.json()) as { item: { id: string } }).item.id;
}

async function createTemplate(account: Account, worldId: string, name: string): Promise<string> {
  const response = await request(`/bestiary/worlds/${worldId}/templates`, 'POST', { name, description: '', fields: [{ key: 'forca', label: 'Força', type: 'NUMBER', required: false }] }, account);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function createEntity(account: Account, extra: Record<string, unknown>): Promise<string> {
  const response = await request('/vault', 'POST', { entityType: 'NPC', name: 'Base', summary: '', description: '', visibility: 'PRIVATE', worldId: null, groupId: null, parentEntityId: null, adventure: null, ...extra }, account);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

interface Backup { schemaVersion: number; data: Record<string, unknown[]> }

async function exportBackup(account: Account): Promise<Backup> {
  const response = await request('/export', 'GET', undefined, account);
  expect(response.status).toBe(200);
  return (await response.json()) as Backup;
}

describe('F-015: Backup/Restore completo', () => {
  it('export v8 inclui os domínios que faltavam na v7 (especializados/Journal/Wiki/Relations/Cartografia/Timeline/Revisions)', async () => {
    const owner = await register('backup-export-v8');
    const worldId = await createWorld(owner, 'Mundo Exportado');
    const templateId = await createTemplate(owner, worldId, 'Modelo A');
    await createEntity(owner, { entityType: 'CREATURE', name: 'Lobo', worldId, creature: { classification: 'Besta', habitat: '', behavior: '', dangerNotes: '', statBlock: { templateId, values: { forca: 10 } } } });
    await request(`/journal/${worldId}/pages`, 'POST', { title: 'Página', content: 'conteúdo', folderId: null }, owner);

    const backup = await exportBackup(owner);
    expect(backup.schemaVersion).toBe(8);
    expect(backup.data.creatureStatTemplates).toHaveLength(1);
    expect(backup.data.creatureDetails).toHaveLength(1);
    expect(backup.data.creatureStatBlocks).toHaveLength(1);
    expect(backup.data.journalPages).toHaveLength(1);
    expect(backup.data.entityRevisions.length).toBeGreaterThan(0);
  });

  it('round-trip completo: World + hierarquia de Location + Creature com ficha + Journal com pastas aninhadas', async () => {
    const owner = await register('backup-roundtrip');
    const worldId = await createWorld(owner, 'Mundo Original');
    const templateId = await createTemplate(owner, worldId, 'Ficha de Fera');
    const cityId = await createEntity(owner, { entityType: 'LOCATION', name: 'Cidade', worldId });
    await createEntity(owner, { entityType: 'LOCATION', name: 'Distrito', worldId, parentEntityId: cityId });
    await createEntity(owner, { entityType: 'CREATURE', name: 'Grifo', worldId, creature: { classification: 'Fera Mágica', habitat: 'Montanhas', behavior: 'Territorial', dangerNotes: 'Voa', statBlock: { templateId, values: { forca: 18 } } } });
    const rootFolder = await request(`/journal/${worldId}/folders`, 'POST', { name: 'Pasta Raiz', parentFolderId: null }, owner);
    const rootFolderId = ((await rootFolder.json()) as { item: { id: string } }).item.id;
    await request(`/journal/${worldId}/folders`, 'POST', { name: 'Subpasta', parentFolderId: rootFolderId }, owner);
    await request(`/journal/${worldId}/pages`, 'POST', { title: 'Segredos', content: 'texto sensível', folderId: rootFolderId }, owner);

    const backup = await exportBackup(owner);

    const preview = await request('/import/backup/preview', 'POST', { backup: JSON.stringify(backup) }, owner);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { jobId: string; summary: Record<string, number>; warnings: unknown[]; canConfirm: boolean };
    expect(previewBody.canConfirm).toBe(true);
    expect(previewBody.summary).toMatchObject({ worlds: 1, creatureStatTemplates: 1, entities: 3, journalFolders: 2, journalPages: 1 });
    expect(previewBody.warnings).toHaveLength(0);

    const confirm = await request('/import/backup/confirm', 'POST', { jobId: previewBody.jobId }, owner);
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.json() as { restored: Record<string, number> };
    expect(confirmBody.restored).toMatchObject({ worlds: 1, creatureStatTemplates: 1, entities: 3, journalFolders: 2, journalPages: 1 });

    // O restore cria registros NOVOS (nunca sobrescreve) — agora existem 2 Worlds "Mundo
    // Original" para este usuário (o original + o restaurado), confirmando que nada foi
    // destruído nem confundido com o original.
    const worlds = await request('/worlds?pageSize=50', 'GET', undefined, owner);
    const worldItems = ((await worlds.json()) as { items: Array<{ id: string; name: string }> }).items;
    expect(worldItems.filter((item) => item.name === 'Mundo Original')).toHaveLength(2);
    const restoredWorldId = worldItems.find((item) => item.name === 'Mundo Original' && item.id !== worldId)!.id;

    const restoredEntitiesResponse = await request(`/vault?worldId=${restoredWorldId}&pageSize=50`, 'GET', undefined, owner);
    const restoredEntities = ((await restoredEntitiesResponse.json()) as { items: Array<{ id: string; name: string; entityType: string; parentEntityId: string | null; creature: { statBlock: { templateId: string; values: Record<string, unknown> } | null } | null }> }).items;
    expect(restoredEntities).toHaveLength(3);
    const restoredCity = restoredEntities.find((item) => item.name === 'Cidade')!;
    const restoredDistrict = restoredEntities.find((item) => item.name === 'Distrito')!;
    // Hierarquia de Location preservada com os IDs NOVOS (nunca os antigos do backup).
    expect(restoredDistrict.parentEntityId).toBe(restoredCity.id);
    expect(restoredCity.id).not.toBe(cityId);
    const restoredCreature = restoredEntities.find((item) => item.name === 'Grifo')!;
    expect(restoredCreature.creature?.statBlock?.values).toMatchObject({ forca: 18 });
    expect(restoredCreature.creature?.statBlock?.templateId).not.toBe(templateId); // remapeado, nunca reaproveita o ID antigo

    const journal = await request(`/journal/${restoredWorldId}`, 'GET', undefined, owner);
    const journalBody = await journal.json() as { folders: Array<{ id: string; name: string; parentFolderId: string | null }>; pages: Array<{ title: string; folderId: string | null }> };
    expect(journalBody.folders).toHaveLength(2);
    const restoredRoot = journalBody.folders.find((folder) => folder.name === 'Pasta Raiz')!;
    const restoredSub = journalBody.folders.find((folder) => folder.name === 'Subpasta')!;
    expect(restoredSub.parentFolderId).toBe(restoredRoot.id);
    expect(journalBody.pages).toHaveLength(1);
    expect(journalBody.pages[0]).toMatchObject({ title: 'Segredos', folderId: restoredRoot.id });

    // Restaurar cria uma revisão CREATE inicial para cada World/entidade/página restaurada —
    // paridade total com conteúdo criado normalmente (histórico funciona desde o dia 1).
    const revisions = await request(`/worlds/${restoredWorldId}/revisions`, 'GET', undefined, owner);
    const revisionsBody = await revisions.json() as { items: Array<{ action: string }> };
    expect(revisionsBody.items).toHaveLength(1);
    expect(revisionsBody.items[0].action).toBe('CREATE');
  });

  it('restaurar o backup de outra conta cria os dados sob a posse de quem restaura, nunca reatribui ao dono original (nunca um vetor de IDOR)', async () => {
    const victim = await register('backup-idor-victim');
    const victimWorldId = await createWorld(victim, 'Mundo da Vítima');
    await createEntity(victim, { entityType: 'NPC', name: 'NPC da Vítima', worldId: victimWorldId });
    const backup = await exportBackup(victim);

    const attacker = await register('backup-idor-attacker');
    const preview = await request('/import/backup/preview', 'POST', { backup: JSON.stringify(backup) }, attacker);
    expect(preview.status).toBe(200);
    const { jobId } = await preview.json() as { jobId: string };
    const confirm = await request('/import/backup/confirm', 'POST', { jobId }, attacker);
    expect(confirm.status).toBe(200);

    // Restaurado sob a posse de "attacker" — a vítima continua com exatamente 1 World e 1
    // entidade (nada foi criado/alterado na conta original só porque o JSON dela circulou).
    const victimWorlds = await request('/worlds?pageSize=50', 'GET', undefined, victim);
    expect(((await victimWorlds.json()) as { items: unknown[] }).items).toHaveLength(1);
    const attackerWorlds = await request('/worlds?pageSize=50', 'GET', undefined, attacker);
    const attackerWorldItems = ((await attackerWorlds.json()) as { items: Array<{ id: string; name: string; isOwner: boolean }> }).items;
    expect(attackerWorldItems).toHaveLength(1);
    expect(attackerWorldItems[0]).toMatchObject({ name: 'Mundo da Vítima', isOwner: true });
  });

  it('job de restore é owner-only — outra conta não consegue confirmar uma prévia que não é dela (404, não 403)', async () => {
    const owner = await register('backup-job-owner');
    await createWorld(owner, 'Mundo do Job');
    const backup = await exportBackup(owner);
    const preview = await request('/import/backup/preview', 'POST', { backup: JSON.stringify(backup) }, owner);
    const { jobId } = await preview.json() as { jobId: string };

    const stranger = await register('backup-job-stranger');
    const confirm = await request('/import/backup/confirm', 'POST', { jobId }, stranger);
    expect(confirm.status).toBe(404);
  });

  it('schemaVersion incompatível é rejeitado com 422 claro, nunca tenta interpretar o formato antigo', async () => {
    const owner = await register('backup-old-version');
    const response = await request('/import/backup/preview', 'POST', { backup: JSON.stringify({ schemaVersion: 7, data: {} }) }, owner);
    expect(response.status).toBe(422);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_BACKUP_VERSION');
  });

  it('JSON malformado é rejeitado com 422, nunca lança erro genérico', async () => {
    const owner = await register('backup-malformed');
    const response = await request('/import/backup/preview', 'POST', { backup: '{ isso não é json' }, owner);
    expect(response.status).toBe(422);
  });

  it('World/entidade com dados inválidos após validação é pulado com aviso, sem travar o restante do restore', async () => {
    const owner = await register('backup-partial-invalid');
    const validWorldId = await createWorld(owner, 'Mundo Válido');
    await createEntity(owner, { entityType: 'NPC', name: 'NPC Válido', worldId: validWorldId });
    const backup = await exportBackup(owner);
    // Injeta um World com nome vazio (inválido pelo worldInputSchema) no meio do backup real.
    (backup.data.worlds as Array<Record<string, unknown>>).push({ id: 'fake-world-id', owner_user_id: owner.userId, name: '', slug: 'invalido', description: '', default_rpg_id: null, visibility: 'PRIVATE', status: 'ACTIVE', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', archived_at: null });

    const preview = await request('/import/backup/preview', 'POST', { backup: JSON.stringify(backup) }, owner);
    const previewBody = await preview.json() as { summary: { worlds: number }; warnings: Array<{ domain: string }>; canConfirm: boolean };
    expect(previewBody.summary.worlds).toBe(1); // só o World válido entra no plano
    expect(previewBody.warnings.some((warning) => warning.domain === 'worlds')).toBe(true);
    expect(previewBody.canConfirm).toBe(true); // o resto do restore continua disponível
  });
});
