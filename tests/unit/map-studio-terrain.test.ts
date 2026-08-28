import { describe, expect, it } from 'vitest';
import { createEmptyMapDocument } from '../../src/domain/map-studio/editor';
import { BrushEngine, interpolateTerrainStamps, simplifyTerrainPoints } from '../../src/domain/map-studio/terrain/brush-engine';
import { addTerrainLayer, addTerrainStroke, findTerrainLayer, getTerrainDocument, listUnifiedMapLayers, moveUnifiedMapLayer, removeTerrainLayer, updateTerrainLayer } from '../../src/domain/map-studio/terrain/terrain-document';
import { TerrainTileIndex } from '../../src/domain/map-studio/terrain/terrain-spatial-index';
import { textureRegistry } from '../../src/domain/map-studio/terrain/texture-registry';
import { DEFAULT_TERRAIN_BRUSH, type TerrainLayer, type TerrainStroke } from '../../src/domain/map-studio/terrain/terrain-types';
import { isScreenPointInsideViewport, isTerrainPointInsideMap, screenToMapPoint } from '../../src/client/components/map-studio/use-terrain-tool';
import { mapEditorDocumentSchema, terrainDocumentSchema } from '../../src/shared/validation/schemas';

const layerId = '00000000-0000-4000-8000-000000000401';

function id(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function stroke(index = 1, mode: TerrainStroke['mode'] = 'PAINT'): TerrainStroke {
  return {
    id: id(index),
    mode,
    textureId: 'grass',
    brush: { ...DEFAULT_TERRAIN_BRUSH },
    points: [{ x: index * 10, y: 20 }, { x: index * 10 + 80, y: 80 }],
  };
}

function layer(): TerrainLayer {
  return { id: layerId, name: 'Terrain Base', visible: true, locked: false, opacity: 1, strokes: [] };
}

describe('Map Studio Terrain engine', () => {
  it('faz sampling por distância e finaliza um gesto como um único stroke simplificado', () => {
    const engine = new BrushEngine();
    engine.beginStroke(id(1), 'PAINT', 'grass', DEFAULT_TERRAIN_BRUSH, { x: 0, y: 0 });
    engine.addPoint({ x: 1, y: 1 });
    engine.addPoint({ x: 70, y: 0 });
    engine.addPoint({ x: 140, y: 0 });
    const result = engine.endStroke()!;

    expect(result.points).toEqual([{ x: 0, y: 0 }, { x: 140, y: 0 }]);
    expect(result.id).toBe(id(1));
    expect(engine.endStroke()).toBeNull();
    engine.beginStroke(id(2), 'PAINT', 'grass', DEFAULT_TERRAIN_BRUSH, { x: 0, y: 0 });
    engine.cancelStroke();
    expect(engine.addPoint({ x: 10, y: 10 })).toBeNull();
  });

  it('aplica spacing e simplificação sem persistir cada pointermove', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: .1 }, { x: 100, y: 0 }];
    expect(simplifyTerrainPoints(points, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const stamps = interpolateTerrainStamps(points, { ...DEFAULT_TERRAIN_BRUSH, size: 100, spacing: .25 });
    expect(stamps.length).toBeGreaterThanOrEqual(5);
    expect(stamps.at(-1)).toMatchObject({ x: 100, y: 0 });
  });

  it('adiciona paint/erase imutavelmente e permite undo/redo por snapshot do stroke inteiro', () => {
    const empty = addTerrainLayer(createEmptyMapDocument(), layer());
    const painted = addTerrainStroke(empty, layerId, stroke(2));
    const erased = addTerrainStroke(painted, layerId, stroke(3, 'ERASE'));

    expect(getTerrainDocument(empty).layers[0].strokes).toHaveLength(0);
    expect(getTerrainDocument(painted).layers[0].strokes).toEqual([stroke(2)]);
    expect(getTerrainDocument(erased).layers[0].strokes.map((item) => item.mode)).toEqual(['PAINT', 'ERASE']);
    expect(getTerrainDocument(painted).layers[0].strokes).toHaveLength(1); // undo
    expect(getTerrainDocument(erased).layers[0].strokes).toHaveLength(2); // redo
  });

  it('bloqueia pintura em layer locked/hidden e mantém ordering unificado', () => {
    const objectLayerId = '00000000-0000-4000-8000-000000000402';
    const base = addTerrainLayer({ ...createEmptyMapDocument(), layers: [{ id: objectLayerId, name: 'Objetos', visible: true, locked: false, objects: [] }] }, layer());
    const locked = { ...base, extensions: { ...base.extensions, terrain: { ...getTerrainDocument(base), layers: [{ ...layer(), locked: true }] } } };
    const hidden = { ...base, extensions: { ...base.extensions, terrain: { ...getTerrainDocument(base), layers: [{ ...layer(), visible: false }] } } };

    expect(addTerrainStroke(locked, layerId, stroke(4))).toBe(locked);
    expect(addTerrainStroke(hidden, layerId, stroke(4))).toBe(hidden);
    expect(listUnifiedMapLayers(moveUnifiedMapLayer(base, layerId, -1)).map((item) => item.id)).toEqual([layerId, objectLayerId]);
  });

  it('atualiza, localiza e remove Terrain Layers sem afetar layers de objetos', () => {
    const objectLayerId = '00000000-0000-4000-8000-000000000402';
    const base = addTerrainLayer({ ...createEmptyMapDocument(), layers: [{ id: objectLayerId, name: 'Objetos', visible: true, locked: false, objects: [] }] }, layer());
    const updated = updateTerrainLayer(base, layerId, { name: 'Biomas', opacity: .45 });

    expect(findTerrainLayer(updated, layerId)).toMatchObject({ name: 'Biomas', opacity: .45 });
    expect(findTerrainLayer(updated, null)).toBeNull();
    const removed = removeTerrainLayer(updated, layerId);
    expect(getTerrainDocument(removed).layers).toEqual([]);
    expect(removed.layers.map((candidate) => candidate.id)).toEqual([objectLayerId]);
  });

  it('expõe registry determinístico com defaults para todas as texturas V1', () => {
    expect(textureRegistry.list().map((definition) => definition.id)).toEqual([
      'grass','dirt','sand','rock','water','snow','stone','wood','metal','plain',
    ]);
    expect(textureRegistry.applyDefaults('water', DEFAULT_TERRAIN_BRUSH)).toEqual(textureRegistry.applyDefaults('water', DEFAULT_TERRAIN_BRUSH));
    expect(textureRegistry.get('plain').renderer).toBe('plain');
  });

  it('valida Terrain, rejeita payload inválido e continua aceitando documento legado', () => {
    const legacy = createEmptyMapDocument();
    const terrain = addTerrainStroke(addTerrainLayer(legacy, layer()), layerId, stroke(5));
    expect(mapEditorDocumentSchema.safeParse(legacy).success).toBe(true);
    expect(mapEditorDocumentSchema.safeParse(terrain).success).toBe(true);
    expect(terrainDocumentSchema.safeParse({ ...getTerrainDocument(terrain), layers: [{ ...layer(), strokes: [{ ...stroke(5), points: [] }] }] }).success).toBe(false);
    expect(terrainDocumentSchema.safeParse({ ...getTerrainDocument(terrain), layers: [{ ...layer(), strokes: [{ ...stroke(5), textureId: 'copyrighted-pack' }] }] }).success).toBe(false);
  });

  it('invalida apenas tiles afetados e consulta strokes visíveis', () => {
    const index = new TerrainTileIndex();
    const first = stroke(6);
    const dirty = index.synchronize([first]);
    expect(dirty.size).toBeGreaterThan(0);
    expect(index.synchronize([first]).size).toBe(0);
    expect(index.visible([first], { x: 0, y: 0, width: 512, height: 512 })).toEqual([first]);
    expect(index.visible([first], { x: 5000, y: 5000, width: 512, height: 512 })).toEqual([]);
    expect(index.synchronize([]).size).toBeGreaterThan(0);
  });

  it('converte coordenadas corretamente após zoom/pan e letterbox', () => {
    expect(screenToMapPoint(500, 250, { left: 0, top: 0, width: 1000, height: 500 }, { x: 100, y: 50, width: 1000, height: 500 })).toMatchObject({ x: 600, y: 300 });
    expect(screenToMapPoint(500, 250, { left: 0, top: 0, width: 1000, height: 500 }, { x: 350, y: 175, width: 500, height: 250 })).toMatchObject({ x: 600, y: 300 });
    expect(isScreenPointInsideViewport(249, 250, { left: 0, top: 0, width: 1000, height: 500 }, { x: 0, y: 0, width: 500, height: 500 })).toBe(false);
    expect(isScreenPointInsideViewport(250, 250, { left: 0, top: 0, width: 1000, height: 500 }, { x: 0, y: 0, width: 500, height: 500 })).toBe(true);
    expect(isTerrainPointInsideMap({ x: -1, y: 250 }, 500, 500)).toBe(false);
    expect(isTerrainPointInsideMap({ x: 500, y: 500 }, 500, 500)).toBe(true);
  });

  it('mantém 300 strokes válidos, compactos e indexáveis sem canvas raster gigante', () => {
    let document = addTerrainLayer(createEmptyMapDocument(), layer());
    for (let index = 10; index < 310; index += 1) document = addTerrainStroke(document, layerId, stroke(index));
    const serialized = JSON.stringify(document);
    const strokes = getTerrainDocument(document).layers[0].strokes;
    const index = new TerrainTileIndex();

    expect(strokes).toHaveLength(300);
    expect(serialized.length).toBeLessThan(300_000);
    expect(mapEditorDocumentSchema.safeParse(document).success).toBe(true);
    const visible = index.visible(strokes, { x: 0, y: 0, width: 512, height: 512 });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(strokes.length);
  });
});
