import { describe, expect, it } from 'vitest';
import { shouldRevalidateCoverUrl } from '../../src/domain/rpg/cover-policy';

const DEVIR = 'https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png';
const GSTATIC = 'https://encrypted-tbn2.gstatic.com/shopping?q=tbn:ANd9GcS-legacy';
const ALLOWED = 'https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg';

describe('shouldRevalidateCoverUrl (CASO A/B/C)', () => {
  it('capa legada sem alteração: não revalida (CASO C)', () => {
    expect(shouldRevalidateCoverUrl(DEVIR, DEVIR)).toBe(false);
    expect(shouldRevalidateCoverUrl(GSTATIC, GSTATIC)).toBe(false);
  });

  it('capa alterada para o mesmo valor exato: não revalida', () => {
    const persisted = DEVIR;
    const submitted = 'https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png';
    expect(shouldRevalidateCoverUrl(submitted, persisted)).toBe(false);
  });

  it('editada e revertida manualmente para o valor original: não revalida (não usa apenas "dirty")', () => {
    // Simula: valor final submetido volta a ser igual ao persistido, independente do histórico
    // de edição no meio do caminho — a comparação é só o valor final vs. o persistido.
    const persisted = DEVIR;
    const finalSubmittedValue = DEVIR;
    expect(shouldRevalidateCoverUrl(finalSubmittedValue, persisted)).toBe(false);
  });

  it('capa removida (persistida preenchida, nova é null): revalida', () => {
    expect(shouldRevalidateCoverUrl(null, DEVIR)).toBe(true);
  });

  it('capa alterada para um novo host proibido: revalida', () => {
    expect(shouldRevalidateCoverUrl('https://attacker-controlled.example.com/x.jpg', DEVIR)).toBe(true);
  });

  it('capa alterada para um novo host permitido: revalida', () => {
    expect(shouldRevalidateCoverUrl(ALLOWED, DEVIR)).toBe(true);
  });

  it('CREATE (sem valor persistido) sempre revalida quando há coverUrl', () => {
    expect(shouldRevalidateCoverUrl(DEVIR, null)).toBe(true);
    expect(shouldRevalidateCoverUrl(ALLOWED, null)).toBe(true);
  });

  it('CREATE sem coverUrl nenhuma: não precisa revalidar (nada a validar)', () => {
    expect(shouldRevalidateCoverUrl(null, null)).toBe(false);
  });
});
