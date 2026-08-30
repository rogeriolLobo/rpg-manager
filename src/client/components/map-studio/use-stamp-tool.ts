import { useCallback, useMemo, useRef, useState } from 'react';
import { assetLibrary, type AssetDefinition } from '../../../domain/map-studio/assets/asset-library';
import { generateStampBrushObjects } from '../../../domain/map-studio/stamps/stamp-brush';
import { createStampObject } from '../../../domain/map-studio/stamps/stamp-engine';
import {
  DEFAULT_STAMP_BRUSH, MAX_STAMPS_PER_GESTURE,
  type StampBrushSettings, type StampObject, type StampPlacementMode, type StampPoint,
} from '../../../domain/map-studio/stamps/stamp-types';

interface StampGesture {
  layerId: string;
  seed: string;
  points: StampPoint[];
}

interface UseStampToolInput {
  archived: boolean;
  mapWidth: number;
  mapHeight: number;
  availableSlots: number;
  onCommit: (layerId: string, stamps: readonly StampObject[]) => void;
}

export function useStampTool({ archived, mapWidth, mapHeight, availableSlots, onCommit }: UseStampToolInput) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [mode, setMode] = useState<StampPlacementMode>('SINGLE');
  const [settings, setSettings] = useState<StampBrushSettings>(DEFAULT_STAMP_BRUSH);
  const [feedback, setFeedback] = useState('');
  const gestureRef = useRef<StampGesture | null>(null);
  const selectedAsset = useMemo(() => selectedAssetId ? assetLibrary.get(selectedAssetId) : null, [selectedAssetId]);

  const selectAsset = useCallback((asset: AssetDefinition) => {
    gestureRef.current = null;
    setSelectedAssetId(asset.id);
    setFeedback('');
  }, []);

  const cancel = useCallback(() => {
    gestureRef.current = null;
    setSelectedAssetId(null);
    setFeedback('Posicionamento cancelado.');
  }, []);

  const begin = useCallback((point: StampPoint, layerId: string): boolean => {
    if (archived || !selectedAsset) {
      setFeedback(selectedAsset ? 'O mapa está arquivado.' : 'Selecione um asset primeiro.');
      return false;
    }
    if (availableSlots <= 0) {
      setFeedback('O documento atingiu o limite seguro de stamps.');
      return false;
    }
    if (mode === 'SINGLE') {
      const stamp = createStampObject(selectedAsset, layerId, point, crypto.randomUUID());
      onCommit(layerId, [stamp]);
      setFeedback(`${selectedAsset.name} posicionado.`);
      return false;
    }
    gestureRef.current = { layerId, seed: crypto.randomUUID(), points: [point] };
    setFeedback('Pinte uma distribuição no mapa.');
    return true;
  }, [archived, availableSlots, mode, onCommit, selectedAsset]);

  const add = useCallback((point: StampPoint) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const previous = gesture.points.at(-1);
    const minimumDistance = Math.max(4, settings.spacing / 4);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) {
      gesture.points.push(point);
    }
  }, [settings.spacing]);

  const finish = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || !selectedAsset) return;
    const stamps = generateStampBrushObjects({
      asset: selectedAsset,
      layerId: gesture.layerId,
      points: gesture.points,
      settings,
      seed: gesture.seed,
      mapWidth,
      mapHeight,
    });
    const acceptedStamps = stamps.slice(0, availableSlots);
    if (!acceptedStamps.length) {
      setFeedback('O documento atingiu o limite seguro de stamps.');
      return;
    }
    onCommit(gesture.layerId, acceptedStamps);
    const limitReached = acceptedStamps.length < stamps.length || stamps.length === MAX_STAMPS_PER_GESTURE;
    setFeedback(limitReached
      ? `${acceptedStamps.length} stamps adicionados; limite seguro atingido.`
      : `${acceptedStamps.length} stamps adicionados em um gesto.`);
  }, [availableSlots, mapHeight, mapWidth, onCommit, selectedAsset, settings]);

  const cancelGesture = useCallback(() => {
    gestureRef.current = null;
    setFeedback('Gesto cancelado.');
  }, []);

  return {
    selectedAsset,
    mode,
    settings,
    feedback,
    selectAsset,
    setMode,
    setSettings,
    begin,
    add,
    finish,
    cancel,
    cancelGesture,
    isDrawing: () => Boolean(gestureRef.current),
  };
}
