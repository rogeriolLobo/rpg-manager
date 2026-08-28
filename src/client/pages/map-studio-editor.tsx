import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  addMapLayer, addMapObject, cloneMapDocument, findMapObject, findObjectLayer,
  moveMapLayer, removeMapObject, updateMapLayer, updateMapObject,
  type MapEditorDocument, type MapEditorLayer, type MapEditorObject,
} from '../../domain/map-studio/editor';
import { MapCanvas } from '../components/map-studio/map-canvas';
import { InspectorPanel, LayersPanel } from '../components/map-studio/workspace-panels';
import { StatusBar, ToolDock, WorkspaceTopbar, type MapSaveState, type MapTool } from '../components/map-studio/workspace-chrome';
import { patchJson } from '../api/client';

interface MapStudioEditorProps {
  mapId: string;
  mapName: string;
  width: number;
  height: number;
  gridType: 'NONE' | 'SQUARE' | 'HEX_POINTY' | 'HEX_FLAT';
  gridSize: number;
  backgroundUrl: string | null;
  initialDocument: MapEditorDocument;
  initialVersion: number;
  archived: boolean;
  documentSettings: ReactNode;
}

interface SaveResponse { success: true; version: number; updatedAt: string }
interface DragState { objectId: string; startClientX: number; startClientY: number; startX: number; startY: number }
interface PanState { startClientX: number; startClientY: number; startX: number; startY: number }

const HISTORY_LIMIT = 60;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isEditingField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches('input,textarea,select,[contenteditable="true"]');
}

export function MapStudioEditor({
  mapId, mapName, width, height, gridType, gridSize, backgroundUrl,
  initialDocument, initialVersion, archived, documentSettings,
}: MapStudioEditorProps) {
  const [mapState, setMapState] = useState(() => cloneMapDocument(initialDocument));
  const [past, setPast] = useState<MapEditorDocument[]>([]);
  const [future, setFuture] = useState<MapEditorDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(initialDocument.layers.at(-1)?.id ?? null);
  const [tool, setTool] = useState<MapTool>('SELECT');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveState, setSaveState] = useState<MapSaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [toolPanelOpen, setToolPanelOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [inspectorOpen, setInspectorOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [focusMode, setFocusMode] = useState(false);
  const mapStateRef = useRef(mapState);
  const versionRef = useRef(initialVersion);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const panelSnapshotRef = useRef({ toolPanelOpen: true, inspectorOpen: true });

  useEffect(() => { mapStateRef.current = mapState; }, [mapState]);

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 900px)');
    const collapsePanels = () => {
      if (!compactViewport.matches) return;
      setToolPanelOpen(false);
      setInspectorOpen(false);
    };
    compactViewport.addEventListener('change', collapsePanels);
    return () => compactViewport.removeEventListener('change', collapsePanels);
  }, []);

  const commit = useCallback((change: (current: MapEditorDocument) => MapEditorDocument) => {
    if (archived) return;
    setMapState((current) => {
      const next = change(current);
      if (next === current) return current;
      setPast((items) => [...items, cloneMapDocument(current)].slice(-HISTORY_LIMIT));
      setFuture([]);
      setSaveState('dirty');
      setSaveError('');
      return next;
    });
  }, [archived]);

  const save = useCallback(async (snapshot = mapStateRef.current) => {
    if (archived) return;
    setSaveState('saving');
    setSaveError('');
    try {
      const result = await patchJson<SaveResponse>(`/maps/${mapId}/content`, {
        expectedVersion: versionRef.current,
        document: snapshot,
      });
      versionRef.current = result.version;
      setSaveState(mapStateRef.current === snapshot ? 'saved' : 'dirty');
    } catch (reason) {
      setSaveState('error');
      setSaveError(reason instanceof Error ? reason.message : 'Não foi possível salvar o mapa.');
    }
  }, [archived, mapId]);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = window.setTimeout(() => { void save(mapState); }, 900);
    return () => window.clearTimeout(timer);
  }, [mapState, save, saveState]);

  const undo = useCallback(() => {
    if (archived) return;
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((nextItems) => [cloneMapDocument(mapStateRef.current), ...nextItems].slice(0, HISTORY_LIMIT));
      setMapState(cloneMapDocument(previous));
      setSaveState('dirty');
      setSaveError('');
      return items.slice(0, -1);
    });
  }, [archived]);

  const redo = useCallback(() => {
    if (archived) return;
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previousItems) => [...previousItems, cloneMapDocument(mapStateRef.current)].slice(-HISTORY_LIMIT));
      setMapState(cloneMapDocument(next));
      setSaveState('dirty');
      setSaveError('');
      return items.slice(1);
    });
  }, [archived]);

  const selected = useMemo(() => findMapObject(mapState, selectedId), [mapState, selectedId]);
  const selectedLayer = useMemo(() => findObjectLayer(mapState, selectedId), [mapState, selectedId]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((current) => {
      if (!current) {
        panelSnapshotRef.current = { toolPanelOpen, inspectorOpen };
        setToolPanelOpen(false);
        setInspectorOpen(false);
      } else {
        setToolPanelOpen(panelSnapshotRef.current.toolPanelOpen);
        setInspectorOpen(panelSnapshotRef.current.inspectorOpen);
      }
      return !current;
    });
  }, [inspectorOpen, toolPanelOpen]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const editingField = isEditingField(event.target);
      if (event.key === 'Tab' && !editingField) {
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (editingField || !selected || archived) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        commit((current) => removeMapObject(current, selected.id));
        setSelectedId(null);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const movement: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      };
      const delta = movement[event.key];
      if (delta) {
        event.preventDefault();
        commit((current) => updateMapObject(current, selected.id, { x: selected.x + delta.x, y: selected.y + delta.y }));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [archived, commit, redo, save, selected, toggleFocusMode, undo]);

  const addLayer = () => {
    const id = crypto.randomUUID();
    commit((current) => addMapLayer(current, id, `Camada ${current.layers.length + 1}`));
    setActiveLayerId(id);
  };

  const addObject = (type: MapEditorObject['type']) => {
    const layerId = activeLayerId && mapState.layers.some((layer) => layer.id === activeLayerId)
      ? activeLayerId
      : crypto.randomUUID();
    const object: MapEditorObject = {
      id: crypto.randomUUID(), type, x: Math.round(width * .35), y: Math.round(height * .35),
      width: type === 'TEXT' ? 360 : 240, height: type === 'TEXT' ? 90 : 180,
      rotation: 0, fill: type === 'ELLIPSE' ? '#4f7cac' : '#8b5e3c', text: type === 'TEXT' ? 'Texto' : '',
    };
    commit((current) => {
      const withLayer = current.layers.some((layer) => layer.id === layerId)
        ? current
        : addMapLayer(current, layerId, 'Elementos');
      return addMapObject(withLayer, layerId, object);
    });
    setActiveLayerId(layerId);
    setSelectedId(object.id);
    setInspectorOpen(true);
  };

  const beginObjectDrag = (event: ReactPointerEvent<SVGElement>, object: MapEditorObject) => {
    if (tool !== 'SELECT' || archived) return;
    const layer = findObjectLayer(mapStateRef.current, object.id);
    if (layer?.locked) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(object.id);
    setPast((items) => [...items, cloneMapDocument(mapStateRef.current)].slice(-HISTORY_LIMIT));
    setFuture([]);
    setSaveState('dirty');
    dragRef.current = { objectId: object.id, startClientX: event.clientX, startClientY: event.clientY, startX: object.x, startY: object.y };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'PAN') {
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = { startClientX: event.clientX, startClientY: event.clientY, startX: pan.x, startY: pan.y };
    } else if (event.target === event.currentTarget) {
      setSelectedId(null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (panRef.current) {
      const scaleX = width / Math.max(1, bounds.width) / zoom;
      const scaleY = height / Math.max(1, bounds.height) / zoom;
      setPan({
        x: panRef.current.startX - (event.clientX - panRef.current.startClientX) * scaleX,
        y: panRef.current.startY - (event.clientY - panRef.current.startClientY) * scaleY,
      });
    }
    if (dragRef.current) {
      const scaleX = width / Math.max(1, bounds.width) / zoom;
      const scaleY = height / Math.max(1, bounds.height) / zoom;
      const drag = dragRef.current;
      setMapState((current) => updateMapObject(current, drag.objectId, {
        x: drag.startX + (event.clientX - drag.startClientX) * scaleX,
        y: drag.startY + (event.clientY - drag.startClientY) * scaleY,
      }));
    }
  };

  const finishPointer = () => {
    dragRef.current = null;
    panRef.current = null;
  };

  const updateSelected = (update: Partial<Omit<MapEditorObject, 'id' | 'type'>>) => {
    if (!selected) return;
    commit((current) => updateMapObject(current, selected.id, update));
  };

  const updateLayer = (layerId: string, update: Partial<Pick<MapEditorLayer, 'name' | 'visible' | 'locked'>>) => {
    commit((current) => updateMapLayer(current, layerId, update));
  };

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const viewX = pan.x + (width - viewWidth) / 2;
  const viewY = pan.y + (height - viewHeight) / 2;
  const saveLabel = saveState === 'saving' ? 'Salvando…' : saveState === 'dirty' ? 'Alterações pendentes' : saveState === 'error' ? 'Falha ao salvar' : 'Salvo';
  const workspaceClasses = ['map-workspace', focusMode ? 'focus-mode' : '', toolPanelOpen ? '' : 'tool-panel-closed', inspectorOpen ? '' : 'inspector-closed'].filter(Boolean).join(' ');

  return (
    <section className={workspaceClasses} aria-label="Editor do mapa" data-focus-mode={focusMode ? 'true' : 'false'}>
      <WorkspaceTopbar
        mapName={mapName} saveState={saveState} saveLabel={saveLabel} zoom={zoom} archived={archived}
        canUndo={past.length > 0} canRedo={future.length > 0} focusMode={focusMode}
        onUndo={undo} onRedo={redo}
        onZoomOut={() => setZoom((value) => clamp(value - .25, .25, 4))}
        onZoomIn={() => setZoom((value) => clamp(value + .25, .25, 4))}
        onFit={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
        onSave={() => void save()} onToggleFocus={toggleFocusMode}
      />
      <div className="map-workspace-body">
        <ToolDock
          tool={tool} archived={archived} toolPanelOpen={toolPanelOpen} inspectorOpen={inspectorOpen}
          onToolChange={setTool} onAddObject={addObject}
          onToggleToolPanel={() => setToolPanelOpen((open) => !open)}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onShowSettings={() => { setSelectedId(null); setInspectorOpen(true); }}
        />
        {toolPanelOpen && (
          <LayersPanel
            document={mapState} activeLayerId={activeLayerId} archived={archived}
            onClose={() => setToolPanelOpen(false)} onAddLayer={addLayer} onActivateLayer={setActiveLayerId}
            onUpdateLayer={updateLayer} onMoveLayer={(layerId, direction) => commit((current) => moveMapLayer(current, layerId, direction))}
          />
        )}
        <MapCanvas
          mapId={mapId} document={mapState} selected={selected} width={width} height={height}
          gridType={gridType} gridSize={gridSize} backgroundUrl={backgroundUrl} tool={tool}
          viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
          onObjectPointerDown={beginObjectDrag} onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove} onPointerFinish={finishPointer}
        />
        {inspectorOpen && (
          <InspectorPanel
            selected={selected} selectedLayer={selectedLayer} archived={archived} onClose={() => setInspectorOpen(false)}
            settings={<div className="map-document-settings"><label>Fundo<input disabled={archived} type="color" value={mapState.backgroundColor} onChange={(event) => commit((current) => ({ ...current, backgroundColor: event.target.value }))}/></label>{documentSettings}</div>}
            onUpdateSelected={updateSelected}
            onRemoveSelected={() => { if (selected) commit((current) => removeMapObject(current, selected.id)); setSelectedId(null); }}
          />
        )}
        {saveState === 'error' && (
          <div className="map-save-error" role="alert"><AlertTriangle size={17}/><span>{saveError}</span><button type="button" onClick={() => void save()}><RotateCcw size={15}/>Tentar novamente</button></div>
        )}
      </div>
      <StatusBar width={width} height={height} gridType={gridType} zoom={zoom} saveLabel={saveLabel}/>
    </section>
  );
}
