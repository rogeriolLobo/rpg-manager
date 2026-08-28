import { describe, expect, it } from 'vitest';
import {
  addMapLayer,
  addMapObject,
  createEmptyMapDocument,
  findMapObject,
  moveMapLayer,
  removeMapObject,
  updateMapLayer,
  updateMapObject,
  type MapEditorObject,
} from '../../src/domain/map-studio/editor';
import { mapEditorDocumentSchema } from '../../src/shared/validation/schemas';

const layerA = '00000000-0000-4000-8000-000000000001';
const layerB = '00000000-0000-4000-8000-000000000002';
const objectId = '00000000-0000-4000-8000-000000000003';

const rectangle: MapEditorObject = {
  id: objectId,
  type: 'RECTANGLE',
  x: 10,
  y: 20,
  width: 100,
  height: 80,
  rotation: 0,
  fill: '#8b5e3c',
  text: '',
};

describe('Map Studio editor domain', () => {
  it('adiciona, edita e remove objetos sem alterar snapshots anteriores', () => {
    const empty = createEmptyMapDocument();
    const withLayer = addMapLayer(empty, layerA, 'Elementos');
    const withObject = addMapObject(withLayer, layerA, rectangle);
    const moved = updateMapObject(withObject, objectId, { x: 42, rotation: 15 });
    const removed = removeMapObject(moved, objectId);

    expect(empty.layers).toEqual([]);
    expect(findMapObject(withObject, objectId)?.x).toBe(10);
    expect(findMapObject(moved, objectId)).toMatchObject({ x: 42, rotation: 15 });
    expect(findMapObject(removed, objectId)).toBeNull();
  });

  it('respeita bloqueio e reordena camadas dentro dos limites', () => {
    const document = addMapLayer(addMapLayer(createEmptyMapDocument(), layerA, 'Base'), layerB, 'Topo');
    const locked = updateMapLayer(document, layerB, { locked: true });
    const ignored = addMapObject(locked, layerB, rectangle);

    expect(ignored.layers[1].objects).toEqual([]);
    expect(moveMapLayer(locked, layerB, -1).layers.map((layer) => layer.id)).toEqual([layerB, layerA]);
    expect(moveMapLayer(locked, layerB, 1)).toBe(locked);
  });

  it('aceita documentos legados e preserva extensões futuras nas operações do editor', () => {
    const legacy = createEmptyMapDocument();
    expect(mapEditorDocumentSchema.safeParse(legacy).success).toBe(true);
    expect(legacy).not.toHaveProperty('extensions');

    const extended = mapEditorDocumentSchema.parse({
      ...legacy,
      extensions: {
        'future.terrain': { version: 1, strokes: [{ id: 'stroke-1' }] },
      },
    });
    const updated = addMapLayer(extended, layerA, 'Elementos');

    expect(updated.extensions).toEqual(extended.extensions);
    expect(mapEditorDocumentSchema.parse(updated).extensions).toEqual(extended.extensions);
  });

  it('mantém o contrato raiz estrito e limita o tamanho do envelope de extensões', () => {
    expect(mapEditorDocumentSchema.safeParse({
      ...createEmptyMapDocument(),
      unknownTopLevelField: true,
    }).success).toBe(false);
    expect(mapEditorDocumentSchema.safeParse({
      ...createEmptyMapDocument(),
      extensions: { 'future.terrain': 'x'.repeat(750_000) },
    }).success).toBe(false);
  });
});
