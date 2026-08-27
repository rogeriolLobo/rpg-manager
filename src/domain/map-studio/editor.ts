import type { MapEditorDocumentInput, MapEditorLayerInput, MapEditorObjectInput } from '../../shared/validation/schemas';

export type MapEditorDocument = MapEditorDocumentInput;
export type MapEditorLayer = MapEditorLayerInput;
export type MapEditorObject = MapEditorObjectInput;

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
  update: Partial<Omit<MapEditorObject, 'id' | 'type'>>,
): MapEditorDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => layer.locked ? layer : {
      ...layer,
      objects: layer.objects.map((object) => object.id === objectId ? { ...object, ...update } : object),
    }),
  };
}

export function removeMapObject(document: MapEditorDocument, objectId: string): MapEditorDocument {
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
  for (const layer of document.layers) {
    const object = layer.objects.find((candidate) => candidate.id === objectId);
    if (object) return object;
  }
  return null;
}

export function findObjectLayer(document: MapEditorDocument, objectId: string | null): MapEditorLayer | null {
  if (!objectId) return null;
  return document.layers.find((layer) => layer.objects.some((object) => object.id === objectId)) ?? null;
}
