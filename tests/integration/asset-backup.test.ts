// F-015 Seção 8 (BATCH21): backup REAL de assets (bytes, não só metadata) — bundle próprio
// (GET/POST /api/v1/files/backup), ver src/server/routes/files.ts e
// src/domain/content/file-asset.ts para o raciocínio completo (zero-cost, nunca R2).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin = 'https://asset-backup.example.com';
const password = 'esta e uma senha longa 2026';
let requestSequence = 1;

interface Account { userId: string; cookie: string; csrf: string }

async function request(path: string, method = 'GET', body?: unknown, account?: Account) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': `203.0.125.${requestSequence++ % 250}`,
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

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x01, 0x02, 0x03]);

async function upload(bytes: Uint8Array, account: Account, filename = 'handout.jpg') {
  const formData = new FormData();
  formData.set('file', new Blob([bytes as BlobPart]), filename);
  return worker.default.fetch(`${origin}/api/v1/files`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': `203.0.125.${requestSequence++ % 250}`, Origin: origin, Cookie: account.cookie, 'X-CSRF-Token': account.csrf },
    body: formData,
  });
}

interface Bundle { schemaVersion: number; assets: Array<{ id: string; entityId: string | null; filename: string; byteLength: number; dataBase64: string }> }

describe('F-015 Seção 8: backup real de assets (bundle de bytes)', () => {
  it('round-trip completo: export do bundle -> asset original removido -> restore -> bytes idênticos e utilizáveis numa conta nova', async () => {
    const owner = await register('asset-backup-roundtrip');
    const uploadResponse = await upload(JPEG_BYTES, owner, 'mapa-do-tesouro.jpg');
    expect(uploadResponse.status).toBe(201);
    const originalAssetId = ((await uploadResponse.json()) as { item: { id: string } }).item.id;

    const bundleResponse = await request('/files/backup', 'GET', undefined, owner);
    expect(bundleResponse.status).toBe(200);
    const bundle = await bundleResponse.json() as Bundle;
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0].filename).toBe('mapa-do-tesouro.jpg');

    // Remove o asset original (simula "ambiente de origem não existe mais") — o bundle já
    // exportado precisa continuar restaurável de forma totalmente independente disso.
    const deleteResponse = await request(`/files/${originalAssetId}`, 'DELETE', undefined, owner);
    expect(deleteResponse.status).toBe(204);
    const afterDelete = await request(`/files/${originalAssetId}/content`, 'GET', undefined, owner);
    expect(afterDelete.status).toBe(404);

    // Restaura numa conta NOVA (prova que o bundle é genuinamente autocontido, não uma
    // referência ao estado antigo).
    const restorer = await register('asset-backup-restorer');
    const preview = await request('/files/backup/preview', 'POST', { bundle: JSON.stringify(bundle) }, restorer);
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { summary: { toRestore: number }; canConfirm: boolean };
    expect(previewBody.summary.toRestore).toBe(1);
    expect(previewBody.canConfirm).toBe(true);

    const confirm = await request('/files/backup/confirm', 'POST', { bundle: JSON.stringify(bundle) }, restorer);
    expect(confirm.status).toBe(200);
    const confirmBody = await confirm.json() as { restored: { fileAssets: number } };
    expect(confirmBody.restored.fileAssets).toBe(1);

    const restorerList = await request('/files', 'GET', undefined, restorer);
    const restorerItems = ((await restorerList.json()) as { items: Array<{ id: string; filename: string; contentType: string }> }).items;
    expect(restorerItems).toHaveLength(1);
    expect(restorerItems[0].filename).toBe('mapa-do-tesouro.jpg');
    expect(restorerItems[0].contentType).toBe('image/jpeg'); // resniffado dos bytes reais, nunca confiado do bundle
    expect(restorerItems[0].id).not.toBe(originalAssetId); // ID novo, nunca reaproveita o antigo

    const contentResponse = await request(`/files/${restorerItems[0].id}/content`, 'GET', undefined, restorer);
    expect(contentResponse.status).toBe(200);
    const restoredBytes = new Uint8Array(await contentResponse.arrayBuffer());
    expect([...restoredBytes]).toEqual([...JPEG_BYTES]); // bytes idênticos aos originais
  });

  it('restaurar o bundle de outra conta cria os arquivos sob a posse de quem restaura, nunca reatribui ao dono original', async () => {
    const victim = await register('asset-backup-idor-victim');
    await upload(JPEG_BYTES, victim, 'privado-da-vitima.jpg');
    const bundleResponse = await request('/files/backup', 'GET', undefined, victim);
    const bundle = await bundleResponse.json() as Bundle;

    const attacker = await register('asset-backup-idor-attacker');
    const preview = await request('/files/backup/preview', 'POST', { bundle: JSON.stringify(bundle) }, attacker);
    expect(preview.status).toBe(200);
    const confirm = await request('/files/backup/confirm', 'POST', { bundle: JSON.stringify(bundle) }, attacker);
    expect(confirm.status).toBe(200);

    // A vítima continua com exatamente 1 arquivo — nada foi alterado na conta original só
    // porque o JSON dela circulou.
    const victimList = await request('/files', 'GET', undefined, victim);
    expect(((await victimList.json()) as { items: unknown[] }).items).toHaveLength(1);
    const attackerList = await request('/files', 'GET', undefined, attacker);
    const attackerItems = ((await attackerList.json()) as { items: Array<{ filename: string }> }).items;
    expect(attackerItems).toHaveLength(1);
    expect(attackerItems[0].filename).toBe('privado-da-vitima.jpg'); // restaurado, mas agora sob posse do attacker
  });

  it('vínculo de entidade só é preservado quando a entidade também existe (owned) na conta que restaura', async () => {
    const owner = await register('asset-backup-entity-link');
    const worldResponse = await request('/worlds', 'POST', { name: 'Mundo do Asset', description: '', defaultRpgId: null, visibility: 'PRIVATE' }, owner);
    const worldId = ((await worldResponse.json()) as { item: { id: string } }).item.id;
    const entityResponse = await request('/vault', 'POST', { entityType: 'NPC', name: 'NPC com Anexo', summary: '', description: '', visibility: 'PRIVATE', worldId, groupId: null, parentEntityId: null, adventure: null }, owner);
    const entityId = ((await entityResponse.json()) as { id: string }).id;
    const uploadResponse = await upload(JPEG_BYTES, owner, 'retrato.jpg');
    const assetId = ((await uploadResponse.json()) as { item: { id: string } }).item.id;
    // Vincula manualmente via update direto não existe (POST /files não tem PATCH); o link já
    // foi feito no upload normal com entityId — repetimos o upload passando entityId desta vez.
    const formData = new FormData();
    formData.set('file', new Blob([JPEG_BYTES as BlobPart]), 'retrato.jpg');
    formData.set('entityId', entityId);
    const linkedUploadResponse = await worker.default.fetch(`${origin}/api/v1/files`, { method: 'POST', headers: { 'CF-Connecting-IP': `203.0.125.${requestSequence++ % 250}`, Origin: origin, Cookie: owner.cookie, 'X-CSRF-Token': owner.csrf }, body: formData });
    expect(linkedUploadResponse.status).toBe(201);
    await request(`/files/${assetId}`, 'DELETE', undefined, owner); // remove o primeiro (sem vínculo), fica só o vinculado

    const bundleResponse = await request('/files/backup', 'GET', undefined, owner);
    const bundle = await bundleResponse.json() as Bundle;
    const linkedEntry = bundle.assets.find((asset) => asset.entityId === entityId)!;
    expect(linkedEntry).toBeTruthy();

    // Conta SEM essa entidade — o vínculo não pode ser inventado.
    const stranger = await register('asset-backup-entity-stranger');
    const preview = await request('/files/backup/preview', 'POST', { bundle: JSON.stringify(bundle) }, stranger);
    const previewBody = await preview.json() as { warnings: Array<{ message: string; category: string }> };
    expect(previewBody.warnings.some((warning) => warning.message.includes('vínculo'))).toBe(true);
    await request('/files/backup/confirm', 'POST', { bundle: JSON.stringify(bundle) }, stranger);
    const strangerList = await request('/files', 'GET', undefined, stranger);
    const strangerItems = ((await strangerList.json()) as { items: Array<{ entityId: string | null }> }).items;
    expect(strangerItems[0].entityId).toBeNull(); // restaurado, mas sem o vínculo inventado
  });
});
