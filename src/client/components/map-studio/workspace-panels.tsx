import { ArrowDown, ArrowUp, Eye, EyeOff, Layers, Lock, Trash2, Unlock, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MapEditorDocument, MapEditorLayer, MapEditorObject } from '../../../domain/map-studio/editor';

interface LayersPanelProps {
  document: MapEditorDocument;
  activeLayerId: string | null;
  archived: boolean;
  onClose: () => void;
  onAddLayer: () => void;
  onActivateLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, update: Partial<Pick<MapEditorLayer, 'name' | 'visible' | 'locked'>>) => void;
  onMoveLayer: (layerId: string, direction: -1 | 1) => void;
}

export function LayersPanel({
  document, activeLayerId, archived, onClose, onAddLayer, onActivateLayer, onUpdateLayer, onMoveLayer,
}: LayersPanelProps) {
  return (
    <aside className="map-tool-panel" aria-label="Painel de camadas">
      <div className="map-panel-heading">
        <h2><Layers size={17}/>Camadas</h2>
        <button type="button" onClick={onClose} aria-label="Fechar painel de camadas" title="Fechar"><X size={17}/></button>
      </div>
      <button type="button" className="map-panel-primary" disabled={archived} onClick={onAddLayer}>+ Nova camada</button>
      <div className="map-layer-list">
        {[...document.layers].reverse().map((layer) => (
          <div key={layer.id} className={`map-layer-row ${activeLayerId === layer.id ? 'active' : ''}`}>
            <input
              className="map-layer-name"
              aria-label={`Renomear camada ${layer.name}`}
              title={layer.name}
              disabled={archived}
              defaultValue={layer.name}
              onFocus={() => onActivateLayer(layer.id)}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (name && name !== layer.name) onUpdateLayer(layer.id, { name });
                else event.target.value = layer.name;
              }}
            />
            <button type="button" aria-label={`${layer.visible ? 'Ocultar' : 'Mostrar'} ${layer.name}`} title={layer.visible ? 'Ocultar' : 'Mostrar'} onClick={() => onUpdateLayer(layer.id, { visible: !layer.visible })}>{layer.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
            <button type="button" aria-label={`${layer.locked ? 'Desbloquear' : 'Bloquear'} ${layer.name}`} title={layer.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => onUpdateLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
            <button type="button" aria-label={`Subir ${layer.name}`} title="Subir" onClick={() => onMoveLayer(layer.id, 1)}><ArrowUp size={14}/></button>
            <button type="button" aria-label={`Descer ${layer.name}`} title="Descer" onClick={() => onMoveLayer(layer.id, -1)}><ArrowDown size={14}/></button>
          </div>
        ))}
      </div>
      {!document.layers.length && <p className="section-note">Adicione uma camada ou um objeto para começar.</p>}
    </aside>
  );
}

interface InspectorPanelProps {
  selected: MapEditorObject | null;
  selectedLayer: MapEditorLayer | null;
  archived: boolean;
  settings: ReactNode;
  onClose: () => void;
  onUpdateSelected: (update: Partial<Omit<MapEditorObject, 'id' | 'type'>>) => void;
  onRemoveSelected: () => void;
}

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function InspectorPanel({
  selected, selectedLayer, archived, settings, onClose, onUpdateSelected, onRemoveSelected,
}: InspectorPanelProps) {
  const disabled = archived || Boolean(selectedLayer?.locked);
  return (
    <aside className="map-inspector-panel" aria-label="Inspector do mapa">
      <div className="map-panel-heading">
        <h2>{selected ? 'Seleção' : 'Configurações do mapa'}</h2>
        <button type="button" onClick={onClose} aria-label="Fechar inspector" title="Fechar"><X size={17}/></button>
      </div>
      {selected ? (
        <div className="map-inspector-grid">
          <strong>{selected.type === 'TEXT' ? 'Texto' : selected.type === 'ELLIPSE' ? 'Elipse' : 'Retângulo'}</strong>
          <p className="map-selection-layer">Camada: {selectedLayer?.name ?? 'Sem camada'}</p>
          {selectedLayer?.locked && <p className="section-note">A camada está bloqueada.</p>}
          <label>X<input disabled={disabled} type="number" value={Math.round(selected.x)} onChange={(event) => onUpdateSelected({ x: numeric(event.target.value, selected.x) })}/></label>
          <label>Y<input disabled={disabled} type="number" value={Math.round(selected.y)} onChange={(event) => onUpdateSelected({ y: numeric(event.target.value, selected.y) })}/></label>
          <label>Largura<input disabled={disabled} min={4} type="number" value={Math.round(selected.width)} onChange={(event) => onUpdateSelected({ width: Math.max(4, numeric(event.target.value, selected.width)) })}/></label>
          <label>{selected.type === 'TEXT' ? 'Tamanho' : 'Altura'}<input disabled={disabled} min={4} type="number" value={Math.round(selected.height)} onChange={(event) => onUpdateSelected({ height: Math.max(4, numeric(event.target.value, selected.height)) })}/></label>
          <label>Rotação<input disabled={disabled} type="number" value={Math.round(selected.rotation)} onChange={(event) => onUpdateSelected({ rotation: numeric(event.target.value, selected.rotation) })}/></label>
          <label>Cor<input disabled={disabled} type="color" value={selected.fill} onChange={(event) => onUpdateSelected({ fill: event.target.value })}/></label>
          {selected.type === 'TEXT' && <label className="span-2">Texto<input disabled={disabled} maxLength={500} value={selected.text} onChange={(event) => onUpdateSelected({ text: event.target.value })}/></label>}
          <button type="button" className="map-remove-object" disabled={disabled} onClick={onRemoveSelected}><Trash2 size={15}/>Remover objeto</button>
        </div>
      ) : settings}
    </aside>
  );
}
