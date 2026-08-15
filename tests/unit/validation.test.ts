import { describe, expect, it } from 'vitest';
import { registerSchema, rpgInputSchema } from '../../src/shared/validation/schemas';
describe('validação de entrada',()=>{it('rejeita senha curta e campo arbitrário',()=>{expect(registerSchema.safeParse({email:'a@example.com',displayName:'A',password:'curta'}).success).toBe(false);expect(registerSchema.safeParse({email:'a@example.com',displayName:'A',password:'uma senha bem longa',admin:true}).success).toBe(false);});it('rejeita enum e notas fora do contrato',()=>{expect(rpgInputSchema.safeParse({title:'Teste',readingStatus:'HACKED',hasPlayed:false,wantsToPlay:false,priority:'NONE',tableStatus:'IDEA',notes:''}).success).toBe(false);});

  const baseRpg = { title: 'Teste', readingStatus: 'READING', hasPlayed: false, wantsToPlay: false, priority: 'NONE', tableStatus: 'IDEA' };

  it('aceita edição de RPG existente sem nenhuma alteração (campos opcionais vazios/nulos)', () => {
    expect(rpgInputSchema.safeParse({
      ...baseRpg, categoryId: null, subgenreId: null, playGroupId: null, plannedPlayDate: null,
      isbn: null, coverUrl: null, coverSourceUrl: null, coverSourceNote: null,
    }).success).toBe(true);
    expect(rpgInputSchema.safeParse({
      ...baseRpg, categoryId: '', subgenreId: '', playGroupId: '', plannedPlayDate: '',
      isbn: '', coverUrl: '', coverSourceUrl: '', coverSourceNote: '',
    }).success).toBe(true);
  });

  it('aceita data "quando jogar" vazia, nula e ISO válida', () => {
    expect(rpgInputSchema.safeParse({ ...baseRpg, plannedPlayDate: '' }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, plannedPlayDate: null }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, plannedPlayDate: '2026-08-14' }).success).toBe(true);
  });

  it('aceita coverUrl de qualquer host HTTPS público (regressão: capa do Google Shopping travava a edição)', () => {
    // coverUrl é usada só pelo navegador como <img src>; o servidor não busca essa URL, então
    // não existe allowlist de hosts (LIB-001) — só validação sintática (isPublicHttpsUrl).
    const result = rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://encrypted-tbn2.gstatic.com/shopping?q=tbn:abc123' });
    expect(result.success).toBe(true);
  });

  it('aceita a URL real da Devir (regressão do segundo achado do smoke manual)', () => {
    const result = rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png' });
    expect(result.success).toBe(true);
  });

  it('rejeita coverUrl com protocolo perigoso ou host privado — não é sobre "host autorizado", é sobre a URL ser segura', () => {
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'data:image/png;base64,abc' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'ftp://example.com/capa.jpg' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://127.0.0.1/capa.jpg' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://192.168.1.10/capa.jpg' }).success).toBe(false);
  });

  it('ISBN aceita vazio, nulo e formatos com/sem hífen (LIB-003: checksum real, não só forma)', () => {
    // 978-3-16-148410-0 é o exemplo clássico de ISBN-13 com checksum válido usado na
    // documentação pública do padrão — mesmo valor usado em tests/unit/isbn.test.ts.
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '' }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: null }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '978-3-16-148410-0' }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '9783161484100' }).success).toBe(true);
  });

  it('ISBN com checksum inválido é rejeitado com field error claro', () => {
    const result = rpgInputSchema.safeParse({ ...baseRpg, isbn: '9783161484101' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors.isbn?.[0]).toContain('ISBN inválido');
  });

  it('cover metadata parcial é válida (capa preenchida sem isbn/fonte/nota)', () => {
    expect(rpgInputSchema.safeParse({
      ...baseRpg, coverUrl: 'https://covers.openlibrary.org/b/isbn/123-L.jpg', isbn: null, coverSourceUrl: null, coverSourceNote: null,
    }).success).toBe(true);
  });
});
