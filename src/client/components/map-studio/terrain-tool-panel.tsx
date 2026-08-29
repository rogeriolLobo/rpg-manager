import { Eraser, Paintbrush, X } from 'lucide-react';
import { applyTerrainBrushPreset, listTerrainBrushPresets, resolveTerrainBrushPreset } from '../../../domain/map-studio/terrain/brush-presets';
import { textureRegistry } from '../../../domain/map-studio/terrain/texture-registry';
import type { TerrainBrush, TerrainLayer, TerrainMode, TerrainTextureId } from '../../../domain/map-studio/terrain/terrain-types';

interface TerrainToolPanelProps {
  activeLayer: TerrainLayer | null;
  archived: boolean;
  mode: TerrainMode;
  textureId: TerrainTextureId;
  brush: TerrainBrush;
  feedback: string;
  onClose: () => void;
  onCreateLayer: () => void;
  onModeChange: (mode: TerrainMode) => void;
  onTextureChange: (textureId: TerrainTextureId) => void;
  onBrushChange: (brush: TerrainBrush) => void;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

export function TerrainToolPanel({
  activeLayer, archived, mode, textureId, brush, feedback, onClose, onCreateLayer,
  onModeChange, onTextureChange, onBrushChange,
}: TerrainToolPanelProps) {
  const disabled = archived || !activeLayer || activeLayer.locked || !activeLayer.visible;
  const activeTexture = textureRegistry.get(textureId);
  const activePreset = resolveTerrainBrushPreset(brush);
  return (
    <aside className="map-tool-panel terrain-tool-panel" aria-label="Painel Terrain">
      <div className="map-panel-heading">
        <h2><Paintbrush size={17}/>Terrain</h2>
        <button type="button" onClick={onClose} aria-label="Fechar painel Terrain" title="Fechar"><X size={17}/></button>
      </div>
      {!activeLayer ? (
        <div className="terrain-empty-state">
          <p>Selecione uma Terrain Layer para pintar.</p>
          <button type="button" className="map-panel-primary" disabled={archived} onClick={onCreateLayer}>+ Create Terrain Layer</button>
        </div>
      ) : (
        <>
          <div className="terrain-active-summary" aria-label="Seleção Terrain ativa">
            <span className="terrain-active-swatch" style={{ background: activeTexture.preview }}/>
            <span><small>{mode === 'PAINT' ? 'Painting' : 'Erasing'} on</small><strong>{activeLayer.name}</strong></span>
            <span><small>Material</small><strong>{activeTexture.name}</strong></span>
            <span><small>Brush</small><strong>{activePreset.name}</strong></span>
          </div>
          {(activeLayer.locked || !activeLayer.visible) && <p className="terrain-feedback" role="status">{activeLayer.locked ? 'Desbloqueie a layer para pintar.' : 'Mostre a layer para pintar.'}</p>}
          {feedback && activeLayer.visible && !activeLayer.locked && <p className="terrain-feedback" role="status">{feedback}</p>}
          <div className="terrain-mode" role="group" aria-label="Modo Terrain">
            <button type="button" className={mode === 'PAINT' ? 'active' : ''} aria-pressed={mode === 'PAINT'} onClick={() => onModeChange('PAINT')}><Paintbrush size={15}/>Paint</button>
            <button type="button" className={mode === 'ERASE' ? 'active' : ''} aria-pressed={mode === 'ERASE'} onClick={() => onModeChange('ERASE')}><Eraser size={15}/>Erase</button>
          </div>
          <h3>Textures</h3>
          <div className="terrain-texture-grid">
            {textureRegistry.list().map((texture) => (
              <button key={texture.id} type="button" className={textureId === texture.id ? 'active' : ''} aria-pressed={textureId === texture.id} aria-label={`Textura ${texture.name}`} onClick={() => onTextureChange(texture.id)}>
                <span className="terrain-texture-preview" style={{ background: texture.preview }}/><span>{texture.name}</span>
              </button>
            ))}
          </div>
          <h3>Brush</h3>
          <div className="terrain-preset-grid" role="group" aria-label="Brush presets">
            {listTerrainBrushPresets().map((preset) => (
              <button key={preset.id} type="button" disabled={disabled} className={brush.presetId === preset.id ? 'active' : ''}
                aria-pressed={brush.presetId === preset.id} title={preset.description}
                onClick={() => onBrushChange(applyTerrainBrushPreset(brush, preset.id))}>
                <span className={`terrain-brush-tip ${preset.id.toLowerCase()}`}/><span>{preset.name}</span>
              </button>
            ))}
          </div>
          <div className="terrain-controls">
            <label>Size <input disabled={disabled} type="range" min="4" max="1024" step="4" value={brush.size} onChange={(event) => onBrushChange({ ...brush, size: Number(event.target.value) })}/><span>{Math.round(brush.size)} px</span></label>
            <label>Opacity <input disabled={disabled} type="range" min="0" max="100" value={percent(brush.opacity)} onChange={(event) => onBrushChange({ ...brush, opacity: Number(event.target.value) / 100 })}/><span>{percent(brush.opacity)}%</span></label>
            <label>Hardness <input disabled={disabled} type="range" min="0" max="100" value={percent(brush.hardness)} onChange={(event) => onBrushChange({ ...brush, hardness: Number(event.target.value) / 100 })}/><span>{percent(brush.hardness)}%</span></label>
            <label>Flow <input disabled={disabled} type="range" min="0" max="100" value={percent(brush.flow)} onChange={(event) => onBrushChange({ ...brush, flow: Number(event.target.value) / 100 })}/><span>{percent(brush.flow)}%</span></label>
            <label>Spacing <input disabled={disabled} type="range" min="5" max="100" value={percent(brush.spacing)} onChange={(event) => onBrushChange({ ...brush, spacing: Number(event.target.value) / 100 })}/><span>{percent(brush.spacing)}%</span></label>
            <label>Smoothing <input disabled={disabled} type="range" min="0" max="100" value={percent(brush.smoothing ?? 0)} onChange={(event) => onBrushChange({ ...brush, smoothing: Number(event.target.value) / 100 })}/><span>{percent(brush.smoothing ?? 0)}%</span></label>
          </div>
          <h3>Texture</h3>
          <div className="terrain-controls">
            <label>Scale <input disabled={disabled} type="range" min="10" max="400" value={Math.round(brush.textureScale * 100)} onChange={(event) => onBrushChange({ ...brush, textureScale: Number(event.target.value) / 100 })}/><span>{Math.round(brush.textureScale * 100)}%</span></label>
            <label>Rotation <input disabled={disabled} type="range" min="-180" max="180" value={brush.textureRotation} onChange={(event) => onBrushChange({ ...brush, textureRotation: Number(event.target.value) })}/><span>{Math.round(brush.textureRotation)}°</span></label>
            {textureId === 'plain' && <label>Color <input disabled={disabled} aria-label="Plain Color" type="color" value={brush.color} onChange={(event) => onBrushChange({ ...brush, color: event.target.value })}/><span>{brush.color}</span></label>}
          </div>
        </>
      )}
    </aside>
  );
}
