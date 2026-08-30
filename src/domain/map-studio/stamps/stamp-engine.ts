import type { AssetDefinition } from '../assets/asset-library';
import type { StampObject, StampPoint } from './stamp-types';

export function createStampObject(
  asset: AssetDefinition,
  layerId: string,
  point: StampPoint,
  id: string,
  scale = 1,
): StampObject {
  const safeScale = Math.max(.1, scale);
  const width = asset.defaultWidth * safeScale;
  const height = asset.defaultHeight * safeScale;
  return {
    id,
    type: 'STAMP',
    assetId: asset.id,
    layerId,
    x: point.x - width / 2,
    y: point.y - height / 2,
    width,
    height,
    rotation: 0,
    opacity: 1,
    flipX: false,
    flipY: false,
  };
}

export function resizeStampPreservingAspect(stamp: StampObject, dimension: 'width' | 'height', value: number): Pick<StampObject, 'width' | 'height'> {
  const aspect = stamp.width / stamp.height;
  const size = Math.max(4, value);
  return dimension === 'width'
    ? { width: size, height: size / aspect }
    : { width: size * aspect, height: size };
}
