import type { MapEditorDocumentInput, MapEditorLayerInput, MapEditorObjectInput } from '../../shared/validation/schemas';
import {
  addStampObjects, duplicateStampObject, findStampObject, moveStampObjectToLayer,
  removeStampObject, updateStampObject,
} from './stamps/stamp-document';
import type { StampObject } from './stamps/stamp-types';

export type MapEditorDocument = MapEditorDocumentInput;
export type MapEditorLayer = MapEditorLayerInput;
export type MapEditorShape = MapEditorObjectInput;
export type MapEditorObject = MapEditorShape | StampObject;
export type MapEditorObjectUpdate = Partial<Omit<MapEditorShape, 'id' | 'type'>>
  & Partial<Omit<StampObject, 'id' | 'type' | 'layerId'>>;

export function createEmptyMapDocument(): MapEditorDocument {
  return { version: 1, backgroundColor: '#f5f1e8', layers: [] };
}

export function cloneMapDocument(document: MapEditorDocument): MapEditorDocument {
  return structuredClone(document);
}

export function addMapLayer(document: MapEditorDocument, id: string, name = 'Nova camada'): MapEditorDocument {
  return {
    ...document,
    layers: [...document.layers, { id, name, visible: true, locked: false, objects: [] }],
  };
}

export function updateMapLayer(
  document: MapEditorDocument,
  layerId: string,
  update: Partial<Pick<MapEditorLayer, 'name' | 'visible' | 'locked'>>,
): MapEditorDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => layer.id === layerId ? { ...layer, ...update } : layer),
  };
}

export function moveMapLayer(document: MapEditorDocument, layerId: string, direction: -1 | 1): MapEditorDocument {
  const index = document.layers.findIndex((layer) => layer.id === layerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= document.layers.length) return document;
  const layers = [...document.layers];
  [layers[index], layers[target]] = [layers[target], layers[index]];
  return { ...document, layers };
}

export function addMapObject(document: MapEditorDocument, layerId: string, object: MapEditorObject): MapEditorDocument {
  if (object.type === 'STAMP') return addStampObjects(document, [{ ...object, layerId }]);
  return {
    ...document,
    layers: document.layers.map((layer) => layer.id === layerId && !layer.locked
      ? { ...layer, objects: [...layer.objects, object] }
      : layer),
  };
}

export function updateMapObject(
  document: MapEditorDocument,
  objectId: string,
  update: MapEditorObjectUpdate,
): MapEditorDocument {
  if (findStampObject(document, objectId)) return updateStampObject(document, objectId, update);
  return {
    ...document,
    layers: document.layers.map((layer) => layer.locked ? layer : {
      ...layer,
      objects: layer.objects.map((object) => object.id === objectId ? { ...object, ...update } : object),
    }),
  };
}

export function removeMapObject(document: MapEditorDocument, objectId: string): MapEditorDocument {
  if (findStampObject(document, objectId)) return removeStampObject(document, objectId);
  return {
    ...document,
    layers: document.layers.map((layer) => layer.locked ? layer : {
      ...layer,
      objects: layer.objects.filter((object) => object.id !== objectId),
    }),
  };
}

export function findMapObject(document: MapEditorDocument, objectId: string | null): MapEditorObject | null {
  if (!objectId) return null;
  const stamp = findStampObject(document, objectId);
  if (stamp) return stamp;
  for (const layer of document.layers) {
    const object = layer.objects.find((candidate) => candidate.id === objectId);
    if (object) return object;
  }
  return null;
}

export function findObjectLayer(document: MapEditorDocument, objectId: string | null): MapEditorLayer | null {
  if (!objectId) return null;
  const stamp = findStampObject(document, objectId);
  if (stamp) return document.layers.find((layer) => layer.id === stamp.layerId) ?? null;
  return document.layers.find((layer) => layer.objects.some((object) => object.id === objectId)) ?? null;
}

export function addMapObjects(document: MapEditorDocument, layerId: string, objects: readonly MapEditorObject[]): MapEditorDocument {
  if (!objects.length) return document;
  const stamps = objects.filter((object): object is StampObject => object.type === 'STAMP').map((stamp) => ({ ...stamp, layerId }));
  const shapes = objects.filter((object): object is MapEditorShape => object.type !== 'STAMP');
  let next = stamps.length ? addStampObjects(document, stamps) : document;
  for (const shape of shapes) next = addMapObject(next, layerId, shape);
  return next;
}

export function duplicateMapObject(document: MapEditorDocument, objectId: string, nextId: string): MapEditorDocument {
  if (findStampObject(document, objectId)) return duplicateStampObject(document, objectId, nextId);
  const object = findMapObject(document, objectId);
  const layer = findObjectLayer(document, objectId);
  if (!object || object.type === 'STAMP' || !layer) return document;
  return addMapObject(document, layer.id, { ...object, id: nextId, x: object.x + 24, y: object.y + 24 });
}

export function moveMapObjectToLayer(document: MapEditorDocument, objectId: string, layerId: string): MapEditorDocument {
  if (findStampObject(document, objectId)) return moveStampObjectToLayer(document, objectId, layerId);
  const source = findObjectLayer(document, objectId);
  const target = document.layers.find((layer) => layer.id === layerId);
  const object = findMapObject(document, objectId);
  if (!source || source.locked || !target || target.locked || !object || object.type === 'STAMP') return document;
  return {
    ...document,
    layers: document.layers.map((layer) => {
      if (layer.id === source.id) return { ...layer, objects: layer.objects.filter((candidate) => candidate.id !== objectId) };
      if (layer.id === target.id) return { ...layer, objects: [...layer.objects, object] };
      return layer;
    }),
  };
}
