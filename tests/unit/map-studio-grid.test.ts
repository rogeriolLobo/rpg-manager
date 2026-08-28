import { describe, expect, it } from 'vitest';
import { createGridPatternGeometry, gridStatusLabel, gridViewportBounds } from '../../src/domain/map-studio/grid-engine';

describe('Map Studio Grid Engine', () => {
  it('não cria geometria quando a grade está desligada', () => {
    expect(createGridPatternGeometry('NONE', 50)).toBeNull();
    expect(gridStatusLabel('NONE')).toBe('Grade desligada');
  });

  it('cria uma célula quadrada com o tamanho solicitado', () => {
    expect(createGridPatternGeometry('SQUARE', 50)).toEqual({ width: 50, height: 50, path: 'M 50 0 H 0 V 50' });
  });

  it('cria hexágonos flat-top reais e distintos da grade quadrada', () => {
    const geometry = createGridPatternGeometry('HEX_FLAT', 50)!;
    expect(geometry.width).toBe(150);
    expect(geometry.height).toBeCloseTo(86.6025, 4);
    expect(geometry.path).toContain('M 100 0 L 75 43.3013');
    expect(geometry.path).not.toBe(createGridPatternGeometry('SQUARE', 50)?.path);
  });

  it('cria hexágonos pointy-top reais e distintos de flat-top', () => {
    const pointy = createGridPatternGeometry('HEX_POINTY', 50)!;
    const flat = createGridPatternGeometry('HEX_FLAT', 50)!;
    expect(pointy.width).toBeCloseTo(86.6025, 4);
    expect(pointy.height).toBe(150);
    expect(pointy.path).toContain('M 0 0 L 43.3013 25');
    expect(pointy.path).not.toBe(flat.path);
  });

  it('calcula bounds estáveis ao mover e ampliar o viewport', () => {
    expect(gridViewportBounds({ x: 37, y: -18, width: 800, height: 600 }, 50)).toEqual({
      minX: -50, minY: -100, maxX: 900, maxY: 650,
    });
  });
});
