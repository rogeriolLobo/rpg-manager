// F-021 (BATCH11): validação pura do mapeamento de campos para PDF — ver src/domain/sheets.ts.
import { describe, expect, it } from 'vitest';
import { validatePdfMapping, type SheetFieldDefinition } from '../../src/domain/sheets';

const fields: SheetFieldDefinition[] = [
  { key: 'conceito', label: 'Conceito', type: 'TEXT', required: true },
  { key: 'recursos', label: 'Recursos', type: 'NUMBER', required: false },
];

describe('validatePdfMapping', () => {
  it('aceita mapeamento vazio', () => {
    expect(validatePdfMapping(fields, {})).toBe(true);
  });

  it('aceita ACROFORM e OVERLAY para campos existentes no modelo', () => {
    expect(validatePdfMapping(fields, {
      conceito: { mode: 'ACROFORM', fieldName: 'txt_conceito' },
      recursos: { mode: 'OVERLAY', page: 1, x: 100, y: 200, fontSize: 12 },
    })).toBe(true);
  });

  it('rejeita mapeamento para chave que não existe no modelo', () => {
    expect(validatePdfMapping(fields, { inexistente: { mode: 'ACROFORM', fieldName: 'x' } })).toBe(false);
  });
});
