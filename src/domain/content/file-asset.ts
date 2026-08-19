// F-028 (BATCH15): Files/Handouts/Assets — anexo genérico (imagem/PDF) ligado
// opcionalmente a uma Vault Entity. Generaliza o padrão já provado por LIB-005
// (src/domain/rpg/cover-asset.ts — Zero Cost, Workers KV Free para bytes, D1 só para
// metadata/ownership, nunca base64 em coluna) — ver docs/library/COVER_STORAGE.md para a
// análise de alternativas já feita (continua válida aqui, mesmo padrão de acesso).
//
// Diferença deliberada de COVERS_KV: capa de RPG é catálogo compartilhado (qualquer
// usuário autenticado pode ver por ID); um Files/Assets pode conter handout/mapa privado
// de uma mesa, então a leitura aqui exige dono (ver src/server/routes/files.ts).
//
// Nunca confia no Content-Type declarado pelo cliente: o servidor sempre valida os bytes
// reais ("magic bytes") antes de gravar no KV.

export const MAX_FILE_ASSET_BYTES = 5_000_000; // 5MB — maior que capa (2MB): pode ser um mapa/handout digitalizado.
export const MAX_FILE_ASSETS_PER_USER = 40; // controla acúmulo por conta dentro da cota KV Free (1GB para todos os usuários).

export type FileAssetContentType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP", nos bytes 8..11 de um arquivo RIFF
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function matchesMagic(bytes: Uint8Array, offset: number, magic: number[]): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffFileAssetContentType(bytes: Uint8Array): FileAssetContentType | null {
  if (matchesMagic(bytes, 0, JPEG_MAGIC)) return 'image/jpeg';
  if (matchesMagic(bytes, 0, PNG_MAGIC)) return 'image/png';
  if (matchesMagic(bytes, 0, RIFF_MAGIC) && matchesMagic(bytes, 8, WEBP_MAGIC)) return 'image/webp';
  if (matchesMagic(bytes, 0, PDF_MAGIC)) return 'application/pdf';
  return null;
}

// IDs são sempre gerados por crypto.randomUUID() (nunca vindos do cliente) — validação
// defensiva para que um `:id` de rota mal-formado vire 404 direto, sem montar uma chave de
// KV com conteúdo arbitrário (mesmo princípio de cover-asset.ts).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isValidFileAssetId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function fileAssetKvKey(assetId: string): string {
  return `asset/${assetId}`;
}
