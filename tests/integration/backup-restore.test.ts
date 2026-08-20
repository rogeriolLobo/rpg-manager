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
    expect(backup.schemaVersion).toBe(9);
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

  // BATCH19: revalidação do F-015 cobrindo os domínios criados desde a v8 original (Social,
  // Sheets, world_entity_links, Adventures estruturadas, Files metadata, VTT) — ver
  // src/domain/backup/types.ts para o raciocínio completo do escopo v9.
  it('export v9 inclui todos os domínios criados desde a v8 (Social/Sheets/LINK/Adventures/Files/VTT)', async () => {
    const owner = await register('backup-export-v9');
    const friend = await register('backup-export-v9-friend');

    // Social (F-016/018/019).
    await request(`/social/requests`, 'POST', { targetUserId: friend.userId }, owner);

    // Sheets (F-020/021).
    const worldId = await createWorld(owner, 'Mundo Ficha');
    const templateResponse = await request('/sheets/templates', 'POST', { name: 'Modelo', description: '', worldId, gameSystemId: null, fields: [{ key: 'forca', label: 'Força', type: 'NUMBER', required: false }], pdfUrl: null, pdfMapping: {} }, owner);
    expect(templateResponse.status).toBe(201);
    const templateId = ((await templateResponse.json()) as { id: string }).id;
    const characterId = await createEntity(owner, { entityType: 'CHARACTER', name: 'Personagem', worldId });
    await request(`/sheets/entities/${characterId}`, 'PUT', { templateId, values: { forca: 10 } }, owner);

    // world_entity_links (F-022).
    const otherWorldId = await createWorld(owner, 'Outro Mundo');
    await request(`/vault/${characterId}/links`, 'POST', { worldId: otherWorldId }, owner);

    // Adventures estruturadas (F-025) + Files/Handouts metadata (F-028).
    const adventureId = await createEntity(owner, { entityType: 'ADVENTURE', name: 'Aventura', adventure: { adventureType: 'ONE_SHOT', recommendedSessions: null, notes: '', premise: '', hooks: '', keyScenes: '', rewards: '' } });
    const sceneResponse = await request(`/adventures/${adventureId}/scenes`, 'POST', { act: '', title: 'Cena', summary: '', readAloud: '', gmNotes: '', completed: false, sortOrder: 0 }, owner);
    expect(sceneResponse.status).toBe(201);
    const sceneId = ((await sceneResponse.json()) as { id: string }).id;
    await request(`/adventures/${adventureId}/scenes/${sceneId}/encounters`, 'POST', { name: 'Encontro', difficulty: '', description: '', gmNotes: '', sortOrder: 0 }, owner);
    await request(`/adventures/${adventureId}/scenes/${sceneId}/entities`, 'POST', { entityId: characterId, role: '' }, owner);
    await request(`/adventures/${adventureId}/handouts`, 'POST', { title: 'Handout', content: '', sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 }, owner);

    // Campaign + VTT (F-029/030/032).
    const rpgResponse = await request('/rpgs', 'POST', { title: 'RPG VTT', categoryId: null, subgenreId: null, readingStatus: 'READING', hasPlayed: false, wantsToPlay: true, priority: 'HIGH', playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '', coverUrl: null }, owner);
    const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
    const campaignResponse = await request('/campaigns', 'POST', { rpgId, name: 'Campanha VTT', status: 'PLANNING', gameMaster: '', playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: '', legacyCharactersText: '', notes: '' }, owner);
    const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
    const vttSceneResponse = await request(`/vtt/${campaignId}/scenes`, 'POST', { title: 'Cena VTT', mapId: null, imageUrl: 'https://example.com/mapa.png', notes: '', fogEnabled: true, gridCols: 5, gridRows: 5 }, owner);
    expect(vttSceneResponse.status).toBe(201);
    const vttSceneId = ((await vttSceneResponse.json()) as { id: string }).id;
    await request(`/vtt/${campaignId}/scenes/${vttSceneId}/tokens`, 'POST', { label: 'Token', entityId: null, x: 10, y: 10, visibleToPlayers: false }, owner);
    await request(`/vtt/${campaignId}/scenes/${vttSceneId}/fog/reveal`, 'POST', { col: 0, row: 0 }, owner);
    await request(`/vtt/${campaignId}/scenes/${vttSceneId}/combat/start`, 'POST', { combatants: [{ tokenId: null, name: 'Combatente', initiative: 10, hpCurrent: null, hpMax: null, notes: '', visibleToPlayers: false }] }, owner);

    const backup = await exportBackup(owner);
    expect(backup.schemaVersion).toBe(9);
    expect((backup.data.friendRequests as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.sheetTemplates as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.characterSheets as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.worldEntityLinks as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.adventureScenes as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.adventureEncounters as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.adventureSceneEntities as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.adventureHandouts as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.vttScenes as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.vttTokens as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.vttFogCells as unknown[]).length).toBeGreaterThan(0);
    expect((backup.data.vttCombatants as unknown[]).length).toBeGreaterThan(0);
  });

  it('world_entity_links: round-trip restaura o vínculo com os IDs NOVOS de World e entidade; vínculo sem os dois lados no backup vira aviso, nunca quebra o restore', async () => {
    const owner = await register('backup-link-roundtrip');
    const homeWorldId = await createWorld(owner, 'World de Origem');
    const linkedWorldId = await createWorld(owner, 'World Vinculado');
    const entityId = await createEntity(owner, { entityType: 'NPC', name: 'NPC Vinculado', worldId: homeWorldId });
    await request(`/vault/${entityId}/links`, 'POST', { worldId: linkedWorldId }, owner);

    const backup = await exportBackup(owner);
    expect((backup.data.worldEntityLinks as unknown[])).toHaveLength(1);
    // Injeta um segundo vínculo cujo World alvo não existe neste backup (simula um World que
    // não pôde ser restaurado) — precisa virar aviso, nunca travar o restore inteiro.
    (backup.data.worldEntityLinks as Array<Record<string, unknown>>).push({ world_id: 'world-inexistente', entity_id: entityId, created_at: '2026-01-01T00:00:00.000Z' });

    const preview = await request('/import/backup/preview', 'POST', { backup: JSON.stringify(backup) }, owner);
    const previewBody = await preview.json() as { jobId: string; summary: { worldEntityLinks: number }; warnings: Array<{ domain: string }>; canConfirm: boolean };
    expect(previewBody.summary.worldEntityLinks).toBe(1); // só o vínculo válido entra no plano
    expect(previewBody.warnings.some((warning) => warning.domain === 'worldEntityLinks')).toBe(true);

    const confirm = await request('/import/backup/confirm', 'POST', { jobId: previewBody.jobId }, owner);
    const confirmBody = await confirm.json() as { restored: { worldEntityLinks: number } };
    expect(confirmBody.restored.worldEntityLinks).toBe(1);

    const worlds = await request('/worlds?pageSize=50', 'GET', undefined, owner);
    const worldItems = ((await worlds.json()) as { items: Array<{ id: string; name: string }> }).items;
    const restoredEntityWorldId = worldItems.find((item) => item.name === 'World de Origem' && item.id !== homeWorldId)!.id;
    const restoredEntities = await request(`/vault?worldId=${restoredEntityWorldId}&pageSize=50`, 'GET', undefined, owner);
    const restoredEntityId = ((await restoredEntities.json()) as { items: Array<{ id: string }> }).items[0].id;
    const restoredLinkedWorldId = worldItems.find((item) => item.name === 'World Vinculado' && item.id !== linkedWorldId)!.id;

    const links = await request(`/vault/${restoredEntityId}/links`, 'GET', undefined, owner);
    const linkItems = ((await links.json()) as { items: Array<{ worldId: string }> }).items;
    expect(linkItems).toHaveLength(1);
    expect(linkItems[0].worldId).toBe(restoredLinkedWorldId); // ID NOVO, nunca o antigo
  });
});
