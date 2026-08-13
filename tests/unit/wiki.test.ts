import { describe, expect, it } from 'vitest';
import { extractWikiMentions, normalizeEditorialLabel } from '../../src/domain/content/wiki';
import { validateLoreDetails } from '../../src/domain/content/validation';

describe('organização editorial da Wiki', () => {
  it('normaliza aliases sem perder a forma exibida no banco', () => {
    expect(normalizeEditorialLabel('  Côrte   de Áldea ')).toBe('corte de aldea');
  });

  it('extrai menções únicas para backlinks simples', () => {
    expect(extractWikiMentions('Visite [[Aldea]] e fale com [[ Lucien ]]. Depois volte a [[ALDEA]].'))
      .toEqual(['aldea', 'lucien']);
  });

  it('ignora marcações vazias e texto comum', () => {
    expect(extractWikiMentions('Sem link, [[]] e colchete [isolado].')).toEqual([]);
  });

  it('mantém criação legada de Lore compatível e rejeita detalhes em outro tipo', () => {
    expect(validateLoreDetails('LORE', null)).toBe(true);
    expect(validateLoreDetails('LORE', { loreType: 'HISTORY', canonStatus: 'CANON', source: '' })).toBe(true);
    expect(validateLoreDetails('NPC', { loreType: 'HISTORY', canonStatus: 'CANON', source: '' })).toBe(false);
  });
});
