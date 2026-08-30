import {
  ArrowLeft, Box, Circle, Focus, Hand, Layers, Maximize2, MousePointer2,
  PackageOpen, Paintbrush, PanelLeftClose, PanelRightClose, Redo2, Save, Settings2, Type, Undo2,
  ZoomIn, ZoomOut,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { MapEditorShape } from '../../../domain/map-studio/editor';
import { gridStatusLabel, type MapGridType } from '../../../domain/map-studio/grid-engine';

export type MapSaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type MapTool = 'SELECT' | 'PAN' | 'TERRAIN' | 'ASSETS';
export type ToolPanelKind = 'LAYERS' | 'TERRAIN' | 'ASSETS';

interface WorkspaceTopbarProps {
  mapName: string;
  saveState: MapSaveState;
  saveLabel: string;
  zoom: number;
  archived: boolean;
  canUndo: boolean;
  canRedo: boolean;
  focusMode: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onSave: () => void;
  onToggleFocus: () => void;
}

export function WorkspaceTopbar({
  mapName, saveState, saveLabel, zoom, archived, canUndo, canRedo, focusMode,
  onUndo, onRedo, onZoomOut, onZoomIn, onFit, onSave, onToggleFocus,
}: WorkspaceTopbarProps) {
  return (
    <header className="map-workspace-topbar">
      <Link className="map-workspace-back" to="/app/maps" aria-label="Voltar ao RPG Manager" title="Voltar ao RPG Manager">
        <ArrowLeft size={18}/><span>RPG Manager</span>
      </Link>
      <div className="map-workspace-identity">
        <span>Map Studio</span>
        <h1>{mapName}</h1>
        {archived && <small>Arquivado</small>}
      </div>
      <div className="map-workspace-actions" role="toolbar" aria-label="Ações do workspace">
        <span className={`map-save-state ${saveState}`} aria-live="polite">{saveLabel}</span>
        <button type="button" disabled={!canUndo || archived} onClick={onUndo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)"><Undo2 size={17}/></button>
        <button type="button" disabled={!canRedo || archived} onClick={onRedo} aria-label="Refazer" title="Refazer (Ctrl+Y)"><Redo2 size={17}/></button>
        <button type="button" onClick={onZoomOut} aria-label="Diminuir zoom" title="Diminuir zoom"><ZoomOut size={17}/></button>
        <span className="map-workspace-zoom" aria-label="Zoom atual">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={onZoomIn} aria-label="Aumentar zoom" title="Aumentar zoom"><ZoomIn size={17}/></button>
        <button type="button" onClick={onFit} aria-label="Ajustar mapa" title="Ajustar mapa"><Maximize2 size={17}/></button>
        <button type="button" disabled={saveState === 'saving' || archived} onClick={onSave} aria-label="Salvar agora" title="Salvar agora (Ctrl+S)"><Save size={17}/></button>
        <button type="button" className={focusMode ? 'active' : ''} onClick={onToggleFocus} aria-pressed={focusMode} aria-label="Modo Foco" title="Modo Foco (Tab)"><Focus size={17}/></button>
      </div>
    </header>
  );
}

interface ToolDockProps {
  tool: MapTool;
  archived: boolean;
  toolPanelOpen: boolean;
  toolPanelKind: ToolPanelKind;
  inspectorOpen: boolean;
  onToolChange: (tool: MapTool) => void;
  onAddObject: (type: MapEditorShape['type']) => void;
  onToggleToolPanel: () => void;
  onShowLayers: () => void;
  onToggleInspector: () => void;
  onShowSettings: () => void;
}

export function ToolDock({
  tool, archived, toolPanelOpen, toolPanelKind, inspectorOpen, onToolChange, onAddObject,
  onToggleToolPanel, onShowLayers, onToggleInspector, onShowSettings,
}: ToolDockProps) {
  return (
    <nav className="map-tool-dock" aria-label="Ferramentas do mapa">
      <button type="button" className={tool === 'SELECT' ? 'active' : ''} aria-pressed={tool === 'SELECT'} onClick={() => onToolChange('SELECT')} aria-label="Selecionar" title="Selecionar"><MousePointer2 size={20}/></button>
      <button type="button" className={tool === 'PAN' ? 'active' : ''} aria-pressed={tool === 'PAN'} onClick={() => onToolChange('PAN')} aria-label="Mover tela" title="Mover tela"><Hand size={20}/></button>
      <span className="map-dock-divider" aria-hidden="true"/>
      <button type="button" disabled={archived} className={tool === 'TERRAIN' ? 'active' : ''} aria-pressed={tool === 'TERRAIN'} onClick={() => onToolChange('TERRAIN')} aria-label="Terrain" title="Terrain"><Paintbrush size={20}/></button>
      <button type="button" disabled={archived} className={tool === 'ASSETS' ? 'active' : ''} aria-pressed={tool === 'ASSETS'} onClick={() => onToolChange('ASSETS')} aria-label="Assets" title="Assets"><PackageOpen size={20}/></button>
      <button type="button" disabled={archived} onClick={() => onAddObject('RECTANGLE')} aria-label="Retângulo" title="Retângulo"><Box size={20}/></button>
      <button type="button" disabled={archived} onClick={() => onAddObject('ELLIPSE')} aria-label="Elipse" title="Elipse"><Circle size={20}/></button>
      <button type="button" disabled={archived} onClick={() => onAddObject('TEXT')} aria-label="Texto" title="Texto"><Type size={20}/></button>
      <span className="map-dock-divider" aria-hidden="true"/>
      <button type="button" className={toolPanelOpen && toolPanelKind === 'LAYERS' ? 'active' : ''} aria-pressed={toolPanelOpen && toolPanelKind === 'LAYERS'} onClick={onShowLayers} aria-label="Camadas" title="Camadas"><Layers size={20}/></button>
      <button type="button" className={inspectorOpen ? 'active' : ''} aria-pressed={inspectorOpen} onClick={onShowSettings} aria-label="Configurações do mapa" title="Configurações do mapa"><Settings2 size={20}/></button>
      <span className="map-dock-spacer"/>
      <button type="button" onClick={onToggleToolPanel} aria-label={toolPanelOpen ? 'Recolher painel de ferramentas' : 'Abrir painel de ferramentas'} title={toolPanelOpen ? 'Recolher painel' : 'Abrir painel'}><PanelLeftClose size={20}/></button>
      <button type="button" onClick={onToggleInspector} aria-label={inspectorOpen ? 'Recolher inspector' : 'Abrir inspector'} title={inspectorOpen ? 'Recolher inspector' : 'Abrir inspector'}><PanelRightClose size={20}/></button>
    </nav>
  );
}

interface StatusBarProps {
  width: number;
  height: number;
  gridType: MapGridType;
  zoom: number;
  saveLabel: string;
  toolStatus: string;
}

export function StatusBar({ width, height, gridType, zoom, saveLabel, toolStatus }: StatusBarProps) {
  return (
    <footer className="map-workspace-status" aria-label="Status do mapa">
      <span>{width} × {height}px</span>
      <span>{gridStatusLabel(gridType)}</span>
      <span>{Math.round(zoom * 100)}%</span>
      <span className="map-status-tool">{toolStatus}</span>
      <span>{saveLabel}</span>
      <span className="map-status-hint">Tab: Modo Foco</span>
    </footer>
  );
}
