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

  it('aceita coverUrl legado fora da allowlist de hosts (regressão: capa do Google Shopping travava a edição)', () => {
    // A allowlist de hosts (isAllowedCoverUrl) é aplicada na rota, não no schema — permite
    // reeditar RPGs importados/legados sem forçar re-validação/SSRF de uma capa não alterada.
    const result = rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://encrypted-tbn2.gstatic.com/shopping?q=tbn:abc123' });
    expect(result.success).toBe(true);
  });

  it('rejeita coverUrl com protocolo perigoso ou host privado mesmo fora da allowlist estrita', () => {
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'data:image/png;base64,abc' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'ftp://example.com/capa.jpg' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://127.0.0.1/capa.jpg' }).success).toBe(false);
    expect(rpgInputSchema.safeParse({ ...baseRpg, coverUrl: 'https://192.168.1.10/capa.jpg' }).success).toBe(false);
  });

  it('ISBN aceita vazio, nulo e formatos com/sem hífen', () => {
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '' }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: null }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '978-85-98600-05-2' }).success).toBe(true);
    expect(rpgInputSchema.safeParse({ ...baseRpg, isbn: '9788598600052' }).success).toBe(true);
  });

  it('cover metadata parcial é válida (capa preenchida sem isbn/fonte/nota)', () => {
    expect(rpgInputSchema.safeParse({
      ...baseRpg, coverUrl: 'https://covers.openlibrary.org/b/isbn/123-L.jpg', isbn: null, coverSourceUrl: null, coverSourceNote: null,
    }).success).toBe(true);
  });
});
