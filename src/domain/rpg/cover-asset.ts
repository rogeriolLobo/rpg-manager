// LIB-005: capa enviada por upload (Zero Cost — Workers KV Free), alternativa à
// capa por URL externa (LIB-001, src/shared/security/cover-url.ts). Lógica pura
// (sem D1/KV/Workers) para ser testável isoladamente e compartilhável entre
// cliente (pré-checagem de tamanho antes do upload) e servidor (validação real,
// que nunca confia no cliente) — ver docs/library/COVER_STORAGE.md.
//
// Nunca confia no Content-Type declarado pelo navegador/cliente: o servidor
// sempre valida os bytes reais ("magic bytes") antes de gravar no KV — mesmo
// princípio de nunca confiar cego em dado que entra de fora aplicado ao resto
// do domínio (isbn.ts, url-import.ts).

export const MAX_COVER_ASSET_BYTES = 2_000_000; // 2MB — mesmo limite adotado para import-url (url-import.ts).

export type CoverAssetContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP", nos bytes 8..11 de um arquivo RIFF

function matchesMagic(bytes: Uint8Array, offset: number, magic: number[]): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((byte, index) => bytes[offset + index] === byte);
}

// Detecta o formato real pelos bytes — nunca pelo nome do arquivo ou pelo
// header Content-Type/type do File, ambos livremente forjáveis pelo cliente.
export function sniffCoverAssetContentType(bytes: Uint8Array): CoverAssetContentType | null {
  if (matchesMagic(bytes, 0, JPEG_MAGIC)) return 'image/jpeg';
  if (matchesMagic(bytes, 0, PNG_MAGIC)) return 'image/png';
  if (matchesMagic(bytes, 0, RIFF_MAGIC) && matchesMagic(bytes, 8, WEBP_MAGIC)) return 'image/webp';
  return null;
}

// IDs de asset são sempre gerados por crypto.randomUUID() (nunca vindos do
// cliente) — a validação de formato aqui é defensiva, para que um `:id` de rota
// mal-formado (ou tentativa de path traversal via query string) vire 404 direto,
// sem chegar a montar uma chave de KV com conteúdo arbitrário.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function isValidCoverAssetId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function coverAssetKvKey(assetId: string): string {
  return `cover/${assetId}`;
}
