import { describe, expect, it } from 'vitest';
import { validateCalendarConfig, validateCalendarDate, type WorldCalendarConfig } from '../../src/domain/content/calendar';

const calendar: WorldCalendarConfig = {
  name: 'Calendário Imperial',
  months: [{ name: 'Aurora', days: 30 }, { name: 'Crepúsculo', days: 20 }],
  weekdays: ['Lua', 'Corvo'],
  cycles: [{ name: 'Lua Rubra', lengthDays: 17, offset: 0 }],
  holidays: [{ name: 'Fundação', monthIndex: 0, day: 1, description: '' }],
};

describe('calendário fictício do World', () => {
  it('aceita estrutura flexível e datas dentro do mês', () => {
    expect(validateCalendarConfig(calendar)).toBe(true);
    expect(validateCalendarDate(calendar, { year: -40, monthIndex: 1, day: 20 })).toBe(true);
  });

  it('rejeita nomes duplicados, feriados e datas fora do calendário', () => {
    expect(validateCalendarConfig({ ...calendar, weekdays: ['Lua', 'lua'] })).toBe(false);
    expect(validateCalendarConfig({ ...calendar, holidays: [{ name: 'Erro', monthIndex: 1, day: 21, description: '' }] })).toBe(false);
    expect(validateCalendarDate(calendar, { year: 1, monthIndex: 2, day: 1 })).toBe(false);
  });
});
