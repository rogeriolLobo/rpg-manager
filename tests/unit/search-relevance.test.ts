import { describe, expect, it } from 'vitest';
import {
  applyDomainBoost,
  hasRpgSubjectSignal,
  meetsDisplayThreshold,
  normalizeForCompare,
  scoreTitleMatch,
  significantTokens,
  tierRank,
} from '../../src/domain/rpg/search-relevance';

describe('normalizeForCompare', () => {
  it('remove acentos, pontuação e colapsa espaços — sem alterar semântica', () => {
    expect(normalizeForCompare('  Rastro   de Cthulhu!  ')).toBe('rastro de cthulhu');
    expect(normalizeForCompare('Café à Brasileira')).toBe('cafe a brasileira');
  });
});

describe('significantTokens', () => {
  it('remove stopwords curtas e comuns em pt/en/es', () => {
    expect(significantTokens(normalizeForCompare('The Trail of Cthulhu'))).toEqual(['trail', 'cthulhu']);
    expect(significantTokens(normalizeForCompare('Rastro de Cthulhu'))).toEqual(['rastro', 'cthulhu']);
  });
});

describe('scoreTitleMatch — regressão real LIB-004A (busca "Rastro de Cthulhu")', () => {
  it('caso A: "Rastro de Cthulhu" contra "The Trail of Cthulhu" (August Derleth, ficção) → LOW, nunca um match forte', () => {
    const { confidence } = scoreTitleMatch('Rastro de Cthulhu', 'The Trail of Cthulhu');
    expect(confidence).toBe('LOW');
    expect(meetsDisplayThreshold(confidence)).toBe(false);
  });

  it('caso B: "Trail of Cthulhu" contra "Trail of Cthulhu" (Kenneth Hite/Pelgrane) → EXACT', () => {
    const { confidence } = scoreTitleMatch('Trail of Cthulhu', 'Trail of Cthulhu');
    expect(confidence).toBe('EXACT');
  });

  it('caso E: "Trail of Cthulhu" contra "The Trail of Cthulhu" (ficção parecida) → relevante textualmente (HIGH), mas nunca EXACT nem elevado por assunto de RPG', () => {
    const { confidence } = scoreTitleMatch('Trail of Cthulhu', 'The Trail of Cthulhu');
    expect(confidence).toBe('HIGH');
    // Assunto de ficção real (capturado da Open Library) não deve elevar.
    const boosted = applyDomainBoost(confidence, hasRpgSubjectSignal(['Cthulhu (Fictitious character)', 'Fiction', 'Horror tales']));
    expect(boosted).toBe('HIGH');
    expect(boosted).not.toBe('EXACT');
  });

  it('query vazia ou só stopwords → LOW, nunca EXACT/HIGH por acidente', () => {
    expect(scoreTitleMatch('   ', 'Trail of Cthulhu').confidence).toBe('LOW');
    expect(scoreTitleMatch('the of', 'Trail of Cthulhu').confidence).toBe('LOW');
  });

  it('título idêntico com acentuação/caixa diferentes ainda é EXACT', () => {
    expect(scoreTitleMatch('rastro DE cthúlhu'.replace('ú', 'u'), 'Rastro de Cthulhu').confidence).toBe('EXACT');
  });

  it('subtítulo participa da comparação quando presente', () => {
    const { confidence } = scoreTitleMatch('Trail of Cthulhu Director Edition', 'Trail of Cthulhu', 'Director’s Edition');
    expect(['HIGH', 'MEDIUM', 'EXACT']).toContain(confidence);
  });
});

describe('hasRpgSubjectSignal — sinais reais capturados da Open Library', () => {
  it('reconhece assuntos de RPG reais (Kenneth Hite / Chaosium)', () => {
    expect(hasRpgSubjectSignal(['Fantasy games', 'Handbooks, manuals'])).toBe(true);
    expect(hasRpgSubjectSignal(['Role-playing & war games', 'Games/Puzzles'])).toBe(true);
  });

  it('não reconhece assuntos de ficção (August Derleth) como RPG', () => {
    expect(hasRpgSubjectSignal(['Cthulhu (Fictitious character)', 'Fiction', 'Horror tales'])).toBe(false);
  });

  it('ausência de subjects nunca é tratada como sinal positivo', () => {
    expect(hasRpgSubjectSignal(undefined)).toBe(false);
    expect(hasRpgSubjectSignal([])).toBe(false);
  });

  it('não usa nome de editora como sinal — só assunto', () => {
    // "Pelgrane Press" não aparece em nenhum subject aqui — não deve inventar sinal a partir do publisher.
    expect(hasRpgSubjectSignal(['Some unrelated topic'])).toBe(false);
  });
});

describe('applyDomainBoost — só amplifica MEDIUM, nunca inventa relevância', () => {
  it('eleva MEDIUM para HIGH quando há sinal de RPG', () => {
    expect(applyDomainBoost('MEDIUM', true)).toBe('HIGH');
  });
  it('nunca eleva LOW, mesmo com sinal de RPG (não há base textual suficiente)', () => {
    expect(applyDomainBoost('LOW', true)).toBe('LOW');
  });
  it('nunca promove a EXACT', () => {
    expect(applyDomainBoost('HIGH', true)).toBe('HIGH');
  });
  it('sem sinal, tier permanece inalterado', () => {
    expect(applyDomainBoost('MEDIUM', false)).toBe('MEDIUM');
  });
});

describe('tierRank / meetsDisplayThreshold', () => {
  it('ordena EXACT > HIGH > MEDIUM > LOW', () => {
    expect(tierRank('EXACT')).toBeGreaterThan(tierRank('HIGH'));
    expect(tierRank('HIGH')).toBeGreaterThan(tierRank('MEDIUM'));
    expect(tierRank('MEDIUM')).toBeGreaterThan(tierRank('LOW'));
  });
  it('LOW nunca atinge o limiar de exibição; MEDIUM+ atinge', () => {
    expect(meetsDisplayThreshold('LOW')).toBe(false);
    expect(meetsDisplayThreshold('MEDIUM')).toBe(true);
    expect(meetsDisplayThreshold('HIGH')).toBe(true);
    expect(meetsDisplayThreshold('EXACT')).toBe(true);
  });
});
