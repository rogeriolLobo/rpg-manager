import type { MapEditorDocument } from '../editor';
import { listUnifiedMapLayers } from '../terrain/terrain-document';
import type { StampDocument, StampObject } from './stamp-types';
import { MAX_STAMPS_PER_DOCUMENT } from './stamp-types';

const EMPTY_STAMPS: StampDocument = { version: 1, objects: [] };

export function getStampDocument(document: MapEditorDocument): StampDocument {
  const stamps = document.extensions?.stamps;
  if (!stamps || typeof stamps !== 'object') return EMPTY_STAMPS;
  return stamps as StampDocument;
}

export function withStampDocument(document: MapEditorDocument, stamps: StampDocument): MapEditorDocument {
  return { ...document, extensions: { ...document.extensions, stamps } };
}

export function listStampObjects(document: MapEditorDocument): readonly StampObject[] {
  return getStampDocument(document).objects;
}

export function listStampObjectsForLayer(document: MapEditorDocument, layerId: string): readonly StampObject[] {
  return getStampDocument(document).objects.filter((stamp) => stamp.layerId === layerId);
}

export function findStampObject(document: MapEditorDocument, objectId: string | null): StampObject | null {
  if (!objectId) return null;
  return getStampDocument(document).objects.find((stamp) => stamp.id === objectId) ?? null;
}

export function addStampObjects(document: MapEditorDocument, objects: readonly StampObject[]): MapEditorDocument {
  if (!objects.length) return document;
  const stamps = getStampDocument(document);
  const remaining = MAX_STAMPS_PER_DOCUMENT - stamps.objects.length;
  if (remaining <= 0) return document;
  const layerById = new Map(document.layers.map((layer) => [layer.id, layer]));
  const knownIds = new Set(stamps.objects.map((stamp) => stamp.id));
  const accepted = objects.filter((stamp) => {
    const layer = layerById.get(stamp.layerId);
    return layer && layer.visible && !layer.locked && !knownIds.has(stamp.id) && knownIds.add(stamp.id);
  }).slice(0, remaining);
  if (!accepted.length) return document;
  return withStampDocument(document, { ...stamps, objects: [...stamps.objects, ...accepted] });
}

export function updateStampObject(
  document: MapEditorDocument,
  objectId: string,
  update: Partial<Omit<StampObject, 'id' | 'type' | 'layerId'>>,
): MapEditorDocument {
  const stamps = getStampDocument(document);
  const stamp = stamps.objects.find((candidate) => candidate.id === objectId);
  if (!stamp) return document;
  const layer = document.layers.find((candidate) => candidate.id === stamp.layerId);
  if (!layer || layer.locked) return document;
  return withStampDocument(document, {
    ...stamps,
    objects: stamps.objects.map((candidate) => candidate.id === objectId ? { ...candidate, ...update } : candidate),
  });
}

export function moveStampObjectToLayer(document: MapEditorDocument, objectId: string, layerId: string): MapEditorDocument {
  const stamps = getStampDocument(document);
  const target = document.layers.find((layer) => layer.id === layerId);
  const stamp = stamps.objects.find((candidate) => candidate.id === objectId);
  const source = stamp && document.layers.find((layer) => layer.id === stamp.layerId);
  if (!stamp || !source || source.locked || !target || target.locked) return document;
  return withStampDocument(document, {
    ...stamps,
    objects: stamps.objects.map((candidate) => candidate.id === objectId ? { ...candidate, layerId } : candidate),
  });
}

export function removeStampObject(document: MapEditorDocument, objectId: string): MapEditorDocument {
  const stamps = getStampDocument(document);
  const stamp = stamps.objects.find((candidate) => candidate.id === objectId);
  if (!stamp) return document;
  const layer = document.layers.find((candidate) => candidate.id === stamp.layerId);
  if (!layer || layer.locked) return document;
  return withStampDocument(document, {
    ...stamps,
    objects: stamps.objects.filter((candidate) => candidate.id !== objectId),
  });
}

export function duplicateStampObject(document: MapEditorDocument, objectId: string, nextId: string): MapEditorDocument {
  const stamp = findStampObject(document, objectId);
  if (!stamp) return document;
  return addStampObjects(document, [{ ...stamp, id: nextId, x: stamp.x + 24, y: stamp.y + 24 }]);
}

function pointInsideRotatedStamp(stamp: StampObject, pointX: number, pointY: number): boolean {
  const centerX = stamp.x + stamp.width / 2;
  const centerY = stamp.y + stamp.height / 2;
  const radians = -stamp.rotation * Math.PI / 180;
  const deltaX = pointX - centerX;
  const deltaY = pointY - centerY;
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians) + centerX;
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians) + centerY;
  return localX >= stamp.x && localX <= stamp.x + stamp.width && localY >= stamp.y && localY <= stamp.y + stamp.height;
}

export function findTopmostStampAtPoint(document: MapEditorDocument, x: number, y: number): StampObject | null {
  const stamps = getStampDocument(document).objects;
  const byLayer = new Map<string, StampObject[]>();
  for (const stamp of stamps) {
    const entries = byLayer.get(stamp.layerId) ?? [];
    entries.push(stamp);
    byLayer.set(stamp.layerId, entries);
  }
  const layers = listUnifiedMapLayers(document);
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const layer = layers[layerIndex];
    if (layer.type !== 'OBJECT' || !layer.visible || layer.locked) continue;
    const entries = byLayer.get(layer.id) ?? [];
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (pointInsideRotatedStamp(entries[index], x, y)) return entries[index];
    }
  }
  return null;
}
