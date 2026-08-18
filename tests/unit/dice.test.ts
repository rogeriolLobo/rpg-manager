import { describe, expect, it } from 'vitest';
import { formatTimerSeconds, parseDiceNotation, rollDice } from '../../src/domain/tools/dice';

describe('parseDiceNotation (F-004 GM Tools)', () => {
  it('aceita NdM e NdM+K/NdM-K', () => {
    expect(parseDiceNotation('1d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDiceNotation('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
    expect(parseDiceNotation('4d8-2')).toEqual({ count: 4, sides: 8, modifier: -2 });
  });
  it('rejeita formato inválido, contagem/lados fora do limite', () => {
    expect(parseDiceNotation('d20')).toBeNull();
    expect(parseDiceNotation('abc')).toBeNull();
    expect(parseDiceNotation('21d20')).toBeNull(); // count > 20
    expect(parseDiceNotation('1d1001')).toBeNull(); // sides > 1000
    expect(parseDiceNotation('0d20')).toBeNull(); // count < 1
    expect(parseDiceNotation('1d1')).toBeNull(); // sides < 2
  });
});

describe('rollDice (F-004 GM Tools)', () => {
  it('soma as rolagens + modificador, usando o gerador de aleatoriedade injetado (determinístico no teste)', () => {
    const fixedRandom = () => 0.5; // 1 + floor(0.5*6) = 4 para 1d6
    const result = rollDice('2d6+1', fixedRandom);
    expect(result).toEqual({ notation: '2d6+1', rolls: [4, 4], modifier: 1, total: 9 });
  });
  it('rejeita notação inválida sem lançar exceção', () => {
    expect(rollDice('não é dado')).toBeNull();
  });
  it('rolagens reais (Math.random padrão) sempre ficam dentro do intervalo [1, lados]', () => {
    const result = rollDice('3d8');
    expect(result).not.toBeNull();
    for (const value of result!.rolls) { expect(value).toBeGreaterThanOrEqual(1); expect(value).toBeLessThanOrEqual(8); }
  });
});

describe('formatTimerSeconds (F-004 GM Tools)', () => {
  it('formata minutos:segundos com zero à esquerda', () => {
    expect(formatTimerSeconds(0)).toBe('00:00');
    expect(formatTimerSeconds(65)).toBe('01:05');
    expect(formatTimerSeconds(3599)).toBe('59:59');
  });
  it('lida com valores negativos (tempo esgotado, contagem regressiva continuando)', () => {
    expect(formatTimerSeconds(-5)).toBe('-00:05');
  });
});
