import { describe, expect, it } from 'vitest';
import { classifyIsbn, isbn10ToIsbn13, isIsbnInputValid, isValidIsbn10, isValidIsbn13 } from '../../src/domain/rpg/isbn';

// Exemplos clássicos com checksum verificado manualmente (mesmos usados na
// documentação pública do padrão ISBN — não inventados):
// ISBN-10 válido: 0-306-40615-2 · com dígito X: 0-8044-2957-X
// ISBN-13 válido: 978-3-16-148410-0

describe('ISBN-10 checksum (LIB-003)', () => {
  it('aceita ISBN-10 válido, com e sem hífen/espaço', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
  });
  it('rejeita ISBN-10 com dígito verificador errado', () => {
    expect(isValidIsbn10('0306406153')).toBe(false);
  });
  it('rejeita comprimento errado ou caracteres inválidos', () => {
    expect(isValidIsbn10('030640615')).toBe(false);
    expect(isValidIsbn10('03064061522')).toBe(false);
    expect(isValidIsbn10('030640615A')).toBe(false);
  });
});

describe('ISBN-13 checksum (LIB-003)', () => {
  it('aceita ISBN-13 válido', () => {
    expect(isValidIsbn13('9783161484100')).toBe(true);
  });
  it('rejeita ISBN-13 com dígito verificador errado', () => {
    expect(isValidIsbn13('9783161484101')).toBe(false);
  });
  it('rejeita comprimento errado', () => {
    expect(isValidIsbn13('978316148410')).toBe(false);
    expect(isValidIsbn13('97831614841000')).toBe(false);
  });
});

describe('conversão ISBN-10 -> ISBN-13 (LIB-003)', () => {
  it('deriva o ISBN-13 equivalente correto', () => {
    // 0-306-40615-2 <-> 978-0-306-40615-7 (par oficial de exemplo do padrão)
    expect(isbn10ToIsbn13('0306406152')).toBe('9780306406157');
    expect(isValidIsbn13(isbn10ToIsbn13('0306406152'))).toBe(true);
  });
});

describe('classifyIsbn (LIB-003)', () => {
  it('classifica ISBN-13 direto, sem derivar isbn10', () => {
    expect(classifyIsbn('978-3-16-148410-0')).toEqual({ normalized: '9783161484100', isbn10: null, isbn13: '9783161484100' });
  });
  it('classifica ISBN-10, derivando isbn13 para identidade, preservando o normalizado original', () => {
    expect(classifyIsbn('0-306-40615-2')).toEqual({ normalized: '0306406152', isbn10: '0306406152', isbn13: '9780306406157' });
  });
  it('aceita X maiúsculo ou minúsculo como dígito verificador', () => {
    expect(classifyIsbn('080442957x')?.isbn10).toBe('080442957X');
  });
  it('retorna null para vazio/whitespace (campo opcional, não é erro)', () => {
    expect(classifyIsbn(null)).toBeNull();
    expect(classifyIsbn(undefined)).toBeNull();
    expect(classifyIsbn('')).toBeNull();
    expect(classifyIsbn('   ')).toBeNull();
  });
  it('retorna null para ISBN inválido — não inventa correção', () => {
    expect(classifyIsbn('1234567890123')).toBeNull();
    expect(classifyIsbn('não é isbn')).toBeNull();
    expect(classifyIsbn('123')).toBeNull();
  });
});

describe('isIsbnInputValid (LIB-003)', () => {
  it('vazio é válido (campo opcional)', () => {
    expect(isIsbnInputValid(null)).toBe(true);
    expect(isIsbnInputValid('')).toBe(true);
  });
  it('ISBN correto é válido', () => {
    expect(isIsbnInputValid('9783161484100')).toBe(true);
  });
  it('ISBN incorreto é inválido', () => {
    expect(isIsbnInputValid('9783161484101')).toBe(false);
    expect(isIsbnInputValid('abc')).toBe(false);
  });
});
