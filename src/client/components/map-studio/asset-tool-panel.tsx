import { Brush, MousePointer2, PackageOpen, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  ASSET_CATEGORIES, assetLibrary, type AssetCategory, type AssetDefinition,
} from '../../../domain/map-studio/assets/asset-library';
import type { StampBrushSettings, StampPlacementMode } from '../../../domain/map-studio/stamps/stamp-types';
import { AssetVector } from './asset-vector';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  NATURE: 'Natureza',
  STRUCTURES: 'Estruturas',
  PROPS: 'Objetos',
  ABSTRACT: 'Abstratos',
  SPACE: 'Espaço',
};

interface AssetToolPanelProps {
  archived: boolean;
  selectedAsset: AssetDefinition | null;
  mode: StampPlacementMode;
  settings: StampBrushSettings;
  feedback: string;
  onClose: () => void;
  onSelectAsset: (asset: AssetDefinition) => void;
  onModeChange: (mode: StampPlacementMode) => void;
  onSettingsChange: (settings: StampBrushSettings) => void;
}

function percent(value: number): number { return Math.round(value * 100); }

export function AssetToolPanel({
  archived, selectedAsset, mode, settings, feedback, onClose, onSelectAsset, onModeChange, onSettingsChange,
}: AssetToolPanelProps) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [packId, setPackId] = useState<string | 'ALL'>('ALL');
  const assets = useMemo(() => assetLibrary.search({ text: search, category, packId }), [category, packId, search]);
  const packs = assetLibrary.listPacks();

  return (
    <aside className="map-tool-panel asset-library-panel" aria-label="Biblioteca de assets">
      <div className="map-panel-heading">
        <h2><PackageOpen size={17}/>Assets</h2>
        <button type="button" onClick={onClose} aria-label="Fechar biblioteca de assets" title="Fechar"><X size={17}/></button>
      </div>
      <div className="stamp-mode-switch" role="group" aria-label="Modo de Stamp">
        <button type="button" disabled={archived} className={mode === 'SINGLE' ? 'active' : ''} aria-pressed={mode === 'SINGLE'} onClick={() => onModeChange('SINGLE')}><MousePointer2 size={15}/>Stamp único</button>
        <button type="button" disabled={archived} className={mode === 'BRUSH' ? 'active' : ''} aria-pressed={mode === 'BRUSH'} onClick={() => onModeChange('BRUSH')}><Brush size={15}/>Stamp Brush</button>
      </div>
      {selectedAsset && (
        <div className="asset-active-summary" aria-label="Asset ativo">
          <AssetVector asset={selectedAsset}/>
          <span><strong>{selectedAsset.name}</strong><small>{CATEGORY_LABELS[selectedAsset.category]}</small></span>
        </div>
      )}
      <label className="asset-search"><Search size={15}/><span className="sr-only">Buscar assets</span><input type="search" value={search} placeholder="Buscar assets" onChange={(event) => setSearch(event.target.value)}/></label>
      <div className="asset-filter-row">
        <label>Categoria<select aria-label="Filtrar categoria" value={category} onChange={(event) => setCategory(event.target.value as AssetCategory | 'ALL')}>
          <option value="ALL">Todas</option>
          {ASSET_CATEGORIES.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
        </select></label>
        <label>Pack<select aria-label="Filtrar pack" value={packId} onChange={(event) => setPackId(event.target.value)}>
          <option value="ALL">Todos</option>
          {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
        </select></label>
      </div>
      <p className="asset-result-count" aria-live="polite">{assets.length} assets</p>
      <div className="asset-preview-grid" role="group" aria-label="Assets disponíveis">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            disabled={archived}
            className={selectedAsset?.id === asset.id ? 'active' : ''}
            aria-pressed={selectedAsset?.id === asset.id}
            aria-label={`Selecionar asset ${asset.name}`}
            title={`${asset.name} · ${CATEGORY_LABELS[asset.category]}`}
            onClick={() => onSelectAsset(asset)}
          >
            <AssetVector asset={asset}/><span>{asset.name}</span>
          </button>
        ))}
      </div>
      {!assets.length && <p className="asset-empty-state">Nenhum asset corresponde aos filtros.</p>}
      {mode === 'BRUSH' && (
        <div className="stamp-brush-controls" aria-label="Configurações do Stamp Brush">
          <h3>Distribuição</h3>
          <label>Density <input disabled={archived} type="range" min="1" max="5" value={settings.density} onChange={(event) => onSettingsChange({ ...settings, density: Number(event.target.value) })}/><span>{settings.density}</span></label>
          <label>Spacing <input disabled={archived} type="range" min="16" max="320" step="4" value={settings.spacing} onChange={(event) => onSettingsChange({ ...settings, spacing: Number(event.target.value) })}/><span>{settings.spacing}px</span></label>
          <label>Scale <input disabled={archived} type="range" min="25" max="300" value={percent(settings.scale)} onChange={(event) => onSettingsChange({ ...settings, scale: Number(event.target.value) / 100 })}/><span>{percent(settings.scale)}%</span></label>
          <label>Scale variance <input disabled={archived} type="range" min="0" max="90" value={percent(settings.scaleVariance)} onChange={(event) => onSettingsChange({ ...settings, scaleVariance: Number(event.target.value) / 100 })}/><span>{percent(settings.scaleVariance)}%</span></label>
          <label>Rotation <input disabled={archived} type="range" min="-180" max="180" value={settings.rotation} onChange={(event) => onSettingsChange({ ...settings, rotation: Number(event.target.value) })}/><span>{Math.round(settings.rotation)}°</span></label>
          <label>Rotation variance <input disabled={archived} type="range" min="0" max="180" value={settings.rotationVariance} onChange={(event) => onSettingsChange({ ...settings, rotationVariance: Number(event.target.value) })}/><span>{Math.round(settings.rotationVariance)}°</span></label>
          <label>Position jitter <input disabled={archived} type="range" min="0" max="100" value={percent(settings.positionJitter)} onChange={(event) => onSettingsChange({ ...settings, positionJitter: Number(event.target.value) / 100 })}/><span>{percent(settings.positionJitter)}%</span></label>
          <label className="checkbox-row"><input disabled={archived} type="checkbox" checked={settings.randomFlip} onChange={(event) => onSettingsChange({ ...settings, randomFlip: event.target.checked })}/>Random flip</label>
        </div>
      )}
      <p className="section-note asset-feedback" aria-live="polite">{feedback || (selectedAsset ? 'Clique no mapa para posicionar.' : 'Selecione um asset para começar.')}</p>
    </aside>
  );
}
