import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Layers, Lock, Mountain, Trash2, Unlock, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { assetLibrary } from '../../../domain/map-studio/assets/asset-library';
import type { MapEditorDocument, MapEditorLayer, MapEditorObject, MapEditorObjectUpdate } from '../../../domain/map-studio/editor';
import { resizeStampPreservingAspect } from '../../../domain/map-studio/stamps/stamp-engine';
import { listUnifiedMapLayers } from '../../../domain/map-studio/terrain/terrain-document';
import type { TerrainLayer } from '../../../domain/map-studio/terrain/terrain-types';
import { AssetVector } from './asset-vector';

interface LayersPanelProps {
  document: MapEditorDocument;
  activeLayerId: string | null;
  archived: boolean;
  onClose: () => void;
  onAddLayer: () => void;
  onAddTerrainLayer: () => void;
  onActivateLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, update: Partial<Pick<MapEditorLayer, 'name' | 'visible' | 'locked'>>) => void;
  onUpdateTerrainLayer: (layerId: string, update: Partial<Pick<TerrainLayer, 'name' | 'visible' | 'locked' | 'opacity'>>) => void;
  onMoveLayer: (layerId: string, direction: -1 | 1) => void;
  onRemoveTerrainLayer: (layerId: string) => void;
}

export function LayersPanel({
  document, activeLayerId, archived, onClose, onAddLayer, onAddTerrainLayer, onActivateLayer,
  onUpdateLayer, onUpdateTerrainLayer, onMoveLayer, onRemoveTerrainLayer,
}: LayersPanelProps) {
  const layers = listUnifiedMapLayers(document);
  return (
    <aside className="map-tool-panel" aria-label="Painel de camadas">
      <div className="map-panel-heading">
        <h2><Layers size={17}/>Camadas</h2>
        <button type="button" onClick={onClose} aria-label="Fechar painel de camadas" title="Fechar"><X size={17}/></button>
      </div>
      <div className="map-layer-create-actions">
        <button type="button" className="map-panel-primary" disabled={archived} onClick={onAddLayer}>+ Nova camada</button>
        <button type="button" className="map-panel-primary" disabled={archived} onClick={onAddTerrainLayer}><Mountain size={14}/>+ Terrain</button>
      </div>
      <div className="map-layer-list">
        {[...layers].reverse().map((layer) => {
          const update = layer.type === 'TERRAIN' ? onUpdateTerrainLayer : onUpdateLayer;
          return (
            <div
              key={layer.id}
              className={`map-layer-row ${layer.type === 'TERRAIN' ? 'terrain' : ''} ${activeLayerId === layer.id ? 'active' : ''}`}
              onPointerDown={() => onActivateLayer(layer.id)}
              onFocusCapture={() => onActivateLayer(layer.id)}
            >
              <div className="map-layer-identity">
                <input
                  className="map-layer-name"
                  aria-label={`Renomear camada ${layer.name}`}
                  title={layer.name}
                  disabled={archived}
                  defaultValue={layer.name}
                  onFocus={() => onActivateLayer(layer.id)}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== layer.name) update(layer.id, { name });
                    else event.target.value = layer.name;
                  }}
                />
                {layer.type === 'TERRAIN' && <span className="map-layer-kind"><Mountain size={11}/>Terrain</span>}
              </div>
              <button type="button" aria-label={`${layer.visible ? 'Ocultar' : 'Mostrar'} ${layer.name}`} title={layer.visible ? 'Ocultar' : 'Mostrar'} onClick={() => update(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
              <button type="button" aria-label={`${layer.locked ? 'Desbloquear' : 'Bloquear'} ${layer.name}`} title={layer.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => update(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
              <button type="button" aria-label={`Subir ${layer.name}`} title="Subir" onClick={() => onMoveLayer(layer.id, 1)}><ArrowUp size={14}/></button>
              <button type="button" aria-label={`Descer ${layer.name}`} title="Descer" onClick={() => onMoveLayer(layer.id, -1)}><ArrowDown size={14}/></button>
              {layer.type === 'TERRAIN' && <button type="button" disabled={archived} aria-label={`Excluir ${layer.name}`} title="Excluir Terrain layer" onClick={() => onRemoveTerrainLayer(layer.id)}><Trash2 size={14}/></button>}
              {layer.type === 'TERRAIN' && (
                <label className="map-layer-opacity">Opacity <input aria-label={`Opacity ${layer.name}`} disabled={archived} type="range" min="0" max="100" value={Math.round(layer.opacity * 100)} onChange={(event) => onUpdateTerrainLayer(layer.id, { opacity: Number(event.target.value) / 100 })}/><span>{Math.round(layer.opacity * 100)}%</span></label>
              )}
            </div>
          );
        })}
      </div>
      {!layers.length && <p className="section-note">Adicione uma camada, Terrain ou objeto para começar.</p>}
    </aside>
  );
}

interface InspectorPanelProps {
  document: MapEditorDocument;
  selected: MapEditorObject | null;
  selectedLayer: MapEditorLayer | null;
  archived: boolean;
  settings: ReactNode;
  onClose: () => void;
  onUpdateSelected: (update: MapEditorObjectUpdate) => void;
  onMoveSelectedLayer: (layerId: string) => void;
  onDuplicateSelected: () => void;
  onRemoveSelected: () => void;
}

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function InspectorPanel({
  document, selected, selectedLayer, archived, settings, onClose, onUpdateSelected, onMoveSelectedLayer, onDuplicateSelected, onRemoveSelected,
}: InspectorPanelProps) {
  const disabled = archived || Boolean(selectedLayer?.locked);
  const selectedAsset = selected?.type === 'STAMP' ? assetLibrary.get(selected.assetId) : null;
  return (
    <aside className="map-inspector-panel" aria-label="Inspector do mapa">
      <div className="map-panel-heading">
        <h2>{selected ? 'Seleção' : 'Configurações do mapa'}</h2>
        <button type="button" onClick={onClose} aria-label="Fechar inspector" title="Fechar"><X size={17}/></button>
      </div>
      {selected ? (
        <div className="map-inspector-grid">
          <strong>{selected.type === 'STAMP' ? 'Stamp' : selected.type === 'TEXT' ? 'Texto' : selected.type === 'ELLIPSE' ? 'Elipse' : 'Retângulo'}</strong>
          {selectedAsset && <div className="stamp-inspector-asset"><AssetVector asset={selectedAsset}/><span><small>Asset</small>{selectedAsset.name}</span></div>}
          <label className="span-2">Camada<select disabled={disabled} value={selectedLayer?.id ?? ''} onChange={(event) => onMoveSelectedLayer(event.target.value)}>
            {document.layers.map((layer) => <option key={layer.id} value={layer.id} disabled={layer.locked}>{layer.name}</option>)}
          </select></label>
          {selectedLayer?.locked && <p className="section-note">A camada está bloqueada.</p>}
          <label>X<input disabled={disabled} type="number" value={Math.round(selected.x)} onChange={(event) => onUpdateSelected({ x: numeric(event.target.value, selected.x) })}/></label>
          <label>Y<input disabled={disabled} type="number" value={Math.round(selected.y)} onChange={(event) => onUpdateSelected({ y: numeric(event.target.value, selected.y) })}/></label>
          <label>Largura<input disabled={disabled} min={4} type="number" value={Math.round(selected.width)} onChange={(event) => {
            const width = Math.max(4, numeric(event.target.value, selected.width));
            onUpdateSelected(selected.type === 'STAMP' ? resizeStampPreservingAspect(selected, 'width', width) : { width });
          }}/></label>
          <label>{selected.type === 'TEXT' ? 'Tamanho' : 'Altura'}<input disabled={disabled} min={4} type="number" value={Math.round(selected.height)} onChange={(event) => {
            const height = Math.max(4, numeric(event.target.value, selected.height));
            onUpdateSelected(selected.type === 'STAMP' ? resizeStampPreservingAspect(selected, 'height', height) : { height });
          }}/></label>
          <label>Rotação<input disabled={disabled} type="number" value={Math.round(selected.rotation)} onChange={(event) => onUpdateSelected({ rotation: numeric(event.target.value, selected.rotation) })}/></label>
          {selected.type !== 'STAMP' && <label>Cor<input disabled={disabled} type="color" value={selected.fill} onChange={(event) => onUpdateSelected({ fill: event.target.value })}/></label>}
          {selected.type === 'TEXT' && <label className="span-2">Texto<input disabled={disabled} maxLength={500} value={selected.text} onChange={(event) => onUpdateSelected({ text: event.target.value })}/></label>}
          {selected.type === 'STAMP' && (
            <>
              <label className="span-2">Opacity <input aria-label="Opacity do Stamp" disabled={disabled} type="range" min="0" max="100" value={Math.round(selected.opacity * 100)} onChange={(event) => onUpdateSelected({ opacity: Number(event.target.value) / 100 })}/><span>{Math.round(selected.opacity * 100)}%</span></label>
              <div className="stamp-transform-actions span-2">
                <button type="button" disabled={disabled} className={selected.flipX ? 'active' : ''} aria-pressed={selected.flipX} onClick={() => onUpdateSelected({ flipX: !selected.flipX })}><FlipHorizontal2 size={15}/>Flip X</button>
                <button type="button" disabled={disabled} className={selected.flipY ? 'active' : ''} aria-pressed={selected.flipY} onClick={() => onUpdateSelected({ flipY: !selected.flipY })}><FlipVertical2 size={15}/>Flip Y</button>
              </div>
            </>
          )}
          <div className="map-object-actions span-2">
            <button type="button" disabled={disabled} onClick={onDuplicateSelected}><Copy size={15}/>Duplicar</button>
            <button type="button" className="map-remove-object" disabled={disabled} onClick={onRemoveSelected}><Trash2 size={15}/>Remover objeto</button>
          </div>
        </div>
      ) : settings}
    </aside>
  );
}
