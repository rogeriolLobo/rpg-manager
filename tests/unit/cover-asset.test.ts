import { describe, expect, it } from 'vitest';
import { coverAssetKvKey, isValidCoverAssetId, MAX_COVER_ASSET_BYTES, sniffCoverAssetContentType } from '../../src/domain/rpg/cover-asset';

// LIB-005: bytes reais mínimos de cada formato aceito (headers oficiais dos
// respectivos padrões — não inventados). O corpo depois do header não importa
// para a detecção, só os primeiros bytes/"magic numbers".
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('sniffCoverAssetContentType (LIB-005)', () => {
  it('reconhece JPEG pelos bytes reais', () => {
    expect(sniffCoverAssetContentType(JPEG_BYTES)).toBe('image/jpeg');
  });
  it('reconhece PNG pelos bytes reais', () => {
    expect(sniffCoverAssetContentType(PNG_BYTES)).toBe('image/png');
  });
  it('reconhece WebP (RIFF....WEBP) pelos bytes reais', () => {
    expect(sniffCoverAssetContentType(WEBP_BYTES)).toBe('image/webp');
  });
  it('rejeita um RIFF que não é WEBP (ex.: WAV)', () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffCoverAssetContentType(wav)).toBeNull();
  });
  it('rejeita texto/HTML disfarçado de imagem (nunca confia no Content-Type declarado)', () => {
    const html = new TextEncoder().encode('<html><body>não é imagem</body></html>');
    expect(sniffCoverAssetContentType(html)).toBeNull();
  });
  it('rejeita bytes truncados menores que o header esperado', () => {
    expect(sniffCoverAssetContentType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffCoverAssetContentType(new Uint8Array([]))).toBeNull();
  });
});

describe('isValidCoverAssetId (LIB-005)', () => {
  it('aceita um UUID v4 real (formato gerado por crypto.randomUUID())', () => {
    expect(isValidCoverAssetId(crypto.randomUUID())).toBe(true);
  });
  it('rejeita formatos que não são UUID, incluindo tentativas de path traversal', () => {
    expect(isValidCoverAssetId('../../etc/passwd')).toBe(false);
    expect(isValidCoverAssetId('not-a-uuid')).toBe(false);
    expect(isValidCoverAssetId('')).toBe(false);
    expect(isValidCoverAssetId('11111111-1111-1111-1111-11111111111')).toBe(false); // um dígito a menos
  });
});

describe('coverAssetKvKey (LIB-005)', () => {
  it('prefixa o ID com o namespace lógico "cover/"', () => {
    const id = crypto.randomUUID();
    expect(coverAssetKvKey(id)).toBe(`cover/${id}`);
  });
});

describe('MAX_COVER_ASSET_BYTES (LIB-005)', () => {
  it('mantém um limite positivo e razoável (mesma ordem de grandeza do import-url)', () => {
    expect(MAX_COVER_ASSET_BYTES).toBeGreaterThan(0);
    expect(MAX_COVER_ASSET_BYTES).toBeLessThanOrEqual(5_000_000);
  });
});
