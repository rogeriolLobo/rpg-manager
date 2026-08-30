import type { StampDocumentInput, StampObjectInput } from '../../../shared/validation/schemas';

export type StampObject = StampObjectInput;
export type StampDocument = StampDocumentInput;

export type StampPlacementMode = 'SINGLE' | 'BRUSH';

export interface StampBrushSettings {
  density: number;
  spacing: number;
  scale: number;
  scaleVariance: number;
  rotation: number;
  rotationVariance: number;
  positionJitter: number;
  randomFlip: boolean;
}

export interface StampPoint {
  x: number;
  y: number;
}

export const MAX_STAMPS_PER_DOCUMENT = 2000;
export const MAX_STAMPS_PER_GESTURE = 400;

export const DEFAULT_STAMP_BRUSH: StampBrushSettings = {
  density: 1,
  spacing: 96,
  scale: 1,
  scaleVariance: .2,
  rotation: 0,
  rotationVariance: 35,
  positionJitter: .25,
  randomFlip: true,
};
