import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ASSET_CATEGORIES, assetLibrary, assetAspectRatio } from '../../src/domain/map-studio/assets/asset-library';
import {
  addMapLayer, addMapObjects, cloneMapDocument, createEmptyMapDocument, duplicateMapObject,
  findMapObject, findObjectLayer, moveMapObjectToLayer, removeMapObject, updateMapLayer,
  updateMapObject,
} from '../../src/domain/map-studio/editor';
import { generateStampBrushObjects, sampleStampBrushPath } from '../../src/domain/map-studio/stamps/stamp-brush';
import { createStampObject, resizeStampPreservingAspect } from '../../src/domain/map-studio/stamps/stamp-engine';
import {
  addStampObjects, duplicateStampObject, findStampObject, findTopmostStampAtPoint,
  getStampDocument, listStampObjects, listStampObjectsForLayer, moveStampObjectToLayer,
  removeStampObject, updateStampObject,
} from '../../src/domain/map-studio/stamps/stamp-document';
import { DEFAULT_STAMP_BRUSH, type StampObject } from '../../src/domain/map-studio/stamps/stamp-types';
import {
  mapEditorDocumentSchema, mapEditorLayerSchema, stampObjectSchema, terrainDocumentSchema,
} from '../../src/shared/validation/schemas';

const layerId = '00000000-0000-4000-8000-000000000201';
const secondLayerId = '00000000-0000-4000-8000-000000000202';
const tree = assetLibrary.get('builtin:core/nature/tree-broadleaf')!;

function id(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function stamp(index: number): StampObject {
  return createStampObject(tree, layerId, { x: 100 + index, y: 120 + index }, id(index + 1));
}

function objectDocument() {
  return addMapLayer(createEmptyMapDocument(), layerId, 'Stamps');
}

describe('Map Studio Asset Library', () => {
  it('registra pack built-in, categorias e assets vetoriais legais', () => {
    expect(assetLibrary.listPacks()).toMatchObject([{ id: 'builtin:core', source: 'BUILT_IN' }]);
    expect(assetLibrary.listAssets()).toHaveLength(24);
    expect(new Set(assetLibrary.listAssets().map((asset) => asset.category))).toEqual(new Set(ASSET_CATEGORIES));
    expect(assetLibrary.listAssets().every((asset) => asset.paths.length > 0 && asset.id.startsWith('builtin:core/'))).toBe(true);
  });

  it('busca por nome, tag, categoria e pack sem depender de backend', () => {
    expect(assetLibrary.search({ text: 'arvore' }).map((asset) => asset.name)).toContain('Árvore frondosa');
    expect(assetLibrary.search({ tag: 'forest' }).length).toBeGreaterThan(1);
    expect(assetLibrary.search({ category: 'SPACE' }).every((asset) => asset.category === 'SPACE')).toBe(true);
    expect(assetLibrary.search({ packId: 'builtin:core' })).toHaveLength(24);
    expect(assetLibrary.search({ text: 'inexistente' })).toEqual([]);
  });
});

describe('Map Studio Stamp object', () => {
  it('cria tamanho padrão centralizado e preserva aspect ratio no resize', () => {
    const created = createStampObject(tree, layerId, { x: 400, y: 300 }, id(1));
    expect(created).toMatchObject({ type: 'STAMP', assetId: tree.id, width: tree.defaultWidth, height: tree.defaultHeight, x: 352, y: 244 });
    expect(created.width / created.height).toBeCloseTo(assetAspectRatio(tree));
    expect(resizeStampPreservingAspect(created, 'width', 240)).toEqual({ width: 240, height: 280 });
  });

  it('valida schema e aplica rotation, opacity e flips sem mutar snapshots', () => {
    const initial = addMapObjects(objectDocument(), layerId, [stamp(0)]);
    const updated = updateMapObject(initial, id(1), { rotation: 37, opacity: .45, flipX: true, flipY: true });
    expect(stampObjectSchema.safeParse(findMapObject(updated, id(1))).success).toBe(true);
    expect(findMapObject(updated, id(1))).toMatchObject({ rotation: 37, opacity: .45, flipX: true, flipY: true });
    expect(findMapObject(initial, id(1))).toMatchObject({ rotation: 0, opacity: 1, flipX: false, flipY: false });
    expect(findMapObject(removeMapObject(updated, id(1)), id(1))).toBeNull();
  });

  it('mantém mapa legado sem STAMP válido e sem regravar extensions', () => {
    const legacy = createEmptyMapDocument();
    const parsed = mapEditorDocumentSchema.parse(legacy);
    expect(parsed.extensions).toBeUndefined();
    expect(getStampDocument(parsed).objects).toEqual([]);
  });

  it('mantém STAMP opaco ao passar pelo schema da release anterior', () => {
    const previousReleaseSchema = z.strictObject({
      version: z.literal(1),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/u),
      layers: z.array(mapEditorLayerSchema).max(40),
      extensions: z.object({ terrain: terrainDocumentSchema.optional() }).catchall(z.unknown()).optional(),
    });
    const current = addMapObjects(objectDocument(), layerId, [stamp(0)]);
    const parsedByPreviousRelease = previousReleaseSchema.parse(current);
    expect(parsedByPreviousRelease.extensions?.stamps).toEqual(current.extensions?.stamps);
  });

  it('aplica operações de documento, layers e hit-test sem furar locks', () => {
    const empty = addMapLayer(objectDocument(), secondLayerId, 'Acima');
    const original = stamp(0);
    const placed = addStampObjects(empty, [original]);
    expect(listStampObjects(placed)).toEqual([original]);
    expect(listStampObjectsForLayer(placed, layerId)).toEqual([original]);
    expect(listStampObjectsForLayer(placed, secondLayerId)).toEqual([]);
    expect(findStampObject(placed, null)).toBeNull();
    expect(findStampObject(placed, 'ausente')).toBeNull();
    expect(findObjectLayer(placed, original.id)?.id).toBe(layerId);
    expect(findTopmostStampAtPoint(placed, original.x + original.width / 2, original.y + original.height / 2)?.id).toBe(original.id);

    const updated = updateStampObject(placed, original.id, { rotation: 45, opacity: .5 });
    expect(findStampObject(updated, original.id)).toMatchObject({ rotation: 45, opacity: .5 });
    const moved = moveMapObjectToLayer(updated, original.id, secondLayerId);
    expect(findObjectLayer(moved, original.id)?.id).toBe(secondLayerId);
    const duplicated = duplicateMapObject(moved, original.id, id(99));
    expect(findStampObject(duplicated, id(99))).toMatchObject({ x: original.x + 24, y: original.y + 24 });
    expect(removeStampObject(duplicated, id(99))).not.toEqual(duplicated);

    const locked = updateMapLayer(moved, secondLayerId, { locked: true });
    expect(updateStampObject(locked, original.id, { x: 1 })).toBe(locked);
    expect(removeStampObject(locked, original.id)).toBe(locked);
    expect(moveStampObjectToLayer(locked, original.id, layerId)).toBe(locked);
    expect(findTopmostStampAtPoint(locked, original.x, original.y)).toBeNull();
  });

  it('rejeita batches vazios, duplicados, layers inválidas e o limite do documento', () => {
    const base = objectDocument();
    expect(addStampObjects(base, [])).toBe(base);
    expect(addStampObjects(base, [{ ...stamp(0), layerId: secondLayerId }])).toBe(base);
    expect(updateStampObject(base, id(1), { x: 1 })).toBe(base);
    expect(removeStampObject(base, id(1))).toBe(base);
    expect(moveStampObjectToLayer(base, id(1), layerId)).toBe(base);
    expect(duplicateStampObject(base, id(1), id(2))).toBe(base);

    const placed = addStampObjects(base, [stamp(0)]);
    expect(addStampObjects(placed, [stamp(0)])).toBe(placed);
    expect(moveStampObjectToLayer(placed, id(1), secondLayerId)).toBe(placed);

    const full = addStampObjects(base, Array.from({ length: 2_000 }, (_, index) => stamp(index)));
    expect(listStampObjects(full)).toHaveLength(2_000);
    expect(mapEditorDocumentSchema.safeParse(full).success).toBe(true);
    expect(addStampObjects(full, [{ ...stamp(2_001), id: id(4_000) }])).toBe(full);
  });
});

describe('Map Studio deterministic Stamp Brush', () => {
  const path = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 700, y: 300 }];

  it('faz sampling por spacing e density previsível', () => {
    expect(sampleStampBrushPath(path, 100)).toHaveLength(7);
    const sparse = generateStampBrushObjects({ asset: tree, layerId, points: path, settings: { ...DEFAULT_STAMP_BRUSH, density: 1, spacing: 160 }, seed: 'sparse', mapWidth: 1000, mapHeight: 800 });
    const dense = generateStampBrushObjects({ asset: tree, layerId, points: path, settings: { ...DEFAULT_STAMP_BRUSH, density: 3, spacing: 80 }, seed: 'dense', mapWidth: 1000, mapHeight: 800 });
    expect(dense.length).toBeGreaterThan(sparse.length * 3);
  });

  it('aplica scale variance, rotation variance e position jitter dentro dos limites', () => {
    const settings = { ...DEFAULT_STAMP_BRUSH, density: 3, spacing: 90, scaleVariance: .4, rotation: 15, rotationVariance: 50, positionJitter: .6 };
    const objects = generateStampBrushObjects({ asset: tree, layerId, points: path, settings, seed: 'variance', mapWidth: 1000, mapHeight: 800 });
    expect(new Set(objects.map((object) => object.width.toFixed(3))).size).toBeGreaterThan(3);
    expect(objects.every((object) => object.rotation >= -35 && object.rotation <= 65)).toBe(true);
    expect(objects.some((object) => Math.abs((object.y + object.height / 2) - 100) > 1)).toBe(true);
  });

  it('gera exatamente o mesmo batch para o mesmo seed e diverge para outro seed', () => {
    const input = { asset: tree, layerId, points: path, settings: DEFAULT_STAMP_BRUSH, mapWidth: 1000, mapHeight: 800 };
    const first = generateStampBrushObjects({ ...input, seed: 'forest-42' });
    const second = generateStampBrushObjects({ ...input, seed: 'forest-42' });
    const other = generateStampBrushObjects({ ...input, seed: 'forest-43' });
    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('adiciona um gesto como batch único e permite undo/redo exatos', () => {
    const before = objectDocument();
    const batch = generateStampBrushObjects({ asset: tree, layerId, points: path, settings: { ...DEFAULT_STAMP_BRUSH, density: 2 }, seed: 'history', mapWidth: 1000, mapHeight: 800 });
    const after = addMapObjects(before, layerId, batch);
    const undo = cloneMapDocument(before);
    const redo = cloneMapDocument(after);
    expect(getStampDocument(after).objects).toHaveLength(batch.length);
    expect(getStampDocument(undo).objects).toHaveLength(0);
    expect(getStampDocument(redo).objects).toEqual(batch);
  });
});

describe('Map Studio Stamp safeguards and payload', () => {
  for (const count of [100, 500, 1000]) {
    it(`mantém ${count} stamps válidos e serialização razoável`, () => {
      const document = addMapObjects(objectDocument(), layerId, Array.from({ length: count }, (_, index) => stamp(index)));
      const serialized = JSON.stringify(document);
      expect(getStampDocument(document).objects).toHaveLength(count);
      expect(serialized.length).toBeLessThan(750_000);
      expect(mapEditorDocumentSchema.safeParse(document).success).toBe(true);
    });
  }
});
