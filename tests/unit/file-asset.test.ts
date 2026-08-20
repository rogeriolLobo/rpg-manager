// F-028/F-015 Seção 8: funções puras de domínio de Files/Assets — magic bytes, chave de KV,
// validação de ID e o base64 usado pelo bundle de backup real de assets (BATCH21).
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes, bytesToBase64, fileAssetKvKey, isValidFileAssetId, sniffFileAssetContentType,
} from '../../src/domain/content/file-asset';

describe('sniffFileAssetContentType', () => {
  it('reconhece JPEG pelos magic bytes (FF D8 FF)', () => {
    expect(sniffFileAssetContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('reconhece PNG pelos magic bytes', () => {
    expect(sniffFileAssetContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
  });
  it('reconhece WebP (RIFF....WEBP)', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffFileAssetContentType(bytes)).toBe('image/webp');
  });
  it('reconhece PDF (%PDF)', () => {
    expect(sniffFileAssetContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]))).toBe('application/pdf');
  });
  it('rejeita RIFF sem WEBP nos bytes 8..11 (outro formato RIFF, ex. WAV)', () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
    expect(sniffFileAssetContentType(bytes)).toBeNull();
  });
  it('rejeita bytes que não correspondem a nenhum formato suportado', () => {
    expect(sniffFileAssetContentType(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
  it('rejeita array vazio ou menor que a assinatura', () => {
    expect(sniffFileAssetContentType(new Uint8Array([]))).toBeNull();
    expect(sniffFileAssetContentType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('isValidFileAssetId', () => {
  it('aceita um UUID v4 minúsculo bem formado', () => {
    expect(isValidFileAssetId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('rejeita UUID maiúsculo, malformado ou com conteúdo arbitrário (nunca vira chave de KV)', () => {
    expect(isValidFileAssetId('550E8400-E29B-41D4-A716-446655440000')).toBe(false);
    expect(isValidFileAssetId('não-é-um-uuid')).toBe(false);
    expect(isValidFileAssetId('../../../etc/passwd')).toBe(false);
    expect(isValidFileAssetId('')).toBe(false);
  });
});

describe('fileAssetKvKey', () => {
  it('prefixa o ID com o namespace "asset/"', () => {
    expect(fileAssetKvKey('abc-123')).toBe('asset/abc-123');
  });
});

describe('bytesToBase64/base64ToBytes (bundle de backup de assets, BATCH21)', () => {
  it('round-trip preserva os bytes originais exatamente, incluindo valores 0x00 e 0xff', () => {
    const original = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f, 0x01, 0xfe]);
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
  });
  it('round-trip funciona para um payload maior que um único bloco de codificação (>8KB)', () => {
    const original = new Uint8Array(20_000);
    for (let index = 0; index < original.length; index += 1) original[index] = index % 256;
    const roundTripped = base64ToBytes(bytesToBase64(original));
    expect(roundTripped).toEqual(original);
  });
  it('array vazio produz base64 vazio e volta a um array vazio', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(base64ToBytes('')).toEqual(new Uint8Array([]));
  });
});
