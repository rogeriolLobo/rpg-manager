import type { MapEditorDocument, MapEditorLayer } from '../editor';
import type { TerrainDocument, TerrainLayer, TerrainStroke } from './terrain-types';

const EMPTY_TERRAIN: TerrainDocument = { version: 1, layers: [], layerOrder: [] };

export type UnifiedMapLayer = (MapEditorLayer & { type: 'OBJECT'; opacity: 1 })
  | (TerrainLayer & { type: 'TERRAIN' });

export function getTerrainDocument(document: MapEditorDocument): TerrainDocument {
  const terrain = document.extensions?.terrain;
  if (!terrain || typeof terrain !== 'object') return EMPTY_TERRAIN;
  return terrain as TerrainDocument;
}

export function withTerrainDocument(document: MapEditorDocument, terrain: TerrainDocument): MapEditorDocument {
  return { ...document, extensions: { ...document.extensions, terrain } };
}

function completeOrder(document: MapEditorDocument, terrain: TerrainDocument): string[] {
  const validIds = new Set([...document.layers.map((layer) => layer.id), ...terrain.layers.map((layer) => layer.id)]);
  const ordered = terrain.layerOrder.filter((id, index, items) => validIds.has(id) && items.indexOf(id) === index);
  for (const layer of [...document.layers, ...terrain.layers]) if (!ordered.includes(layer.id)) ordered.push(layer.id);
  return ordered;
}

export function listUnifiedMapLayers(document: MapEditorDocument): UnifiedMapLayer[] {
  const terrain = getTerrainDocument(document);
  const objectById = new Map(document.layers.map((layer) => [layer.id, layer]));
  const terrainById = new Map(terrain.layers.map((layer) => [layer.id, layer]));
  const layers: UnifiedMapLayer[] = [];
  for (const id of completeOrder(document, terrain)) {
    const objectLayer = objectById.get(id);
    if (objectLayer) {
      layers.push({ ...objectLayer, type: 'OBJECT', opacity: 1 });
      continue;
    }
    const terrainLayer = terrainById.get(id);
    if (terrainLayer) layers.push({ ...terrainLayer, type: 'TERRAIN' });
  }
  return layers;
}

export function addTerrainLayer(document: MapEditorDocument, layer: TerrainLayer): MapEditorDocument {
  const terrain = getTerrainDocument(document);
  if (terrain.layers.length >= 20 || terrain.layers.some((candidate) => candidate.id === layer.id)) return document;
  return withTerrainDocument(document, {
    ...terrain,
    layers: [...terrain.layers, layer],
    layerOrder: [...completeOrder(document, terrain), layer.id],
  });
}

export function updateTerrainLayer(document: MapEditorDocument, layerId: string, update: Partial<Pick<TerrainLayer, 'name' | 'visible' | 'locked' | 'opacity'>>): MapEditorDocument {
  const terrain = getTerrainDocument(document);
  if (!terrain.layers.some((layer) => layer.id === layerId)) return document;
  return withTerrainDocument(document, {
    ...terrain,
    layers: terrain.layers.map((layer) => layer.id === layerId ? { ...layer, ...update } : layer),
  });
}

export function removeTerrainLayer(document: MapEditorDocument, layerId: string): MapEditorDocument {
  const terrain = getTerrainDocument(document);
  if (!terrain.layers.some((layer) => layer.id === layerId)) return document;
  return withTerrainDocument(document, {
    ...terrain,
    layers: terrain.layers.filter((layer) => layer.id !== layerId),
    layerOrder: completeOrder(document, terrain).filter((id) => id !== layerId),
  });
}

export function moveUnifiedMapLayer(document: MapEditorDocument, layerId: string, direction: -1 | 1): MapEditorDocument {
  const terrain = getTerrainDocument(document);
  const order = completeOrder(document, terrain);
  const index = order.indexOf(layerId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return document;
  const nextOrder = [...order];
  [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
  return withTerrainDocument(document, { ...terrain, layerOrder: nextOrder });
}

export function findTerrainLayer(document: MapEditorDocument, layerId: string | null): TerrainLayer | null {
  if (!layerId) return null;
  return getTerrainDocument(document).layers.find((layer) => layer.id === layerId) ?? null;
}

export function addTerrainStroke(document: MapEditorDocument, layerId: string, stroke: TerrainStroke): MapEditorDocument {
  const terrain = getTerrainDocument(document);
  const layer = terrain.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.locked || !layer.visible || layer.strokes.length >= 1200) return document;
  return withTerrainDocument(document, {
    ...terrain,
    layers: terrain.layers.map((candidate) => candidate.id === layerId
      ? { ...candidate, strokes: [...candidate.strokes, stroke] }
      : candidate),
  });
}
