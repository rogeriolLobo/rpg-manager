import type { SVGProps } from 'react';
import type { AssetDefinition } from '../../../domain/map-studio/assets/asset-library';

interface AssetVectorProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  asset: AssetDefinition;
  title?: string;
}

export function AssetVector({ asset, title, ...props }: AssetVectorProps) {
  return (
    <svg {...props} viewBox={asset.viewBox.join(' ')} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {asset.paths.map((path, index) => (
        <path
          key={`${asset.id}-${index}`}
          d={path.d}
          fill={path.fill}
          stroke={path.stroke}
          strokeWidth={path.strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
