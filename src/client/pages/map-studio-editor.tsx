import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  addMapLayer, addMapObject, cloneMapDocument, findMapObject, findObjectLayer,
  removeMapObject, updateMapLayer, updateMapObject,
  type MapEditorDocument, type MapEditorLayer, type MapEditorObject,
} from '../../domain/map-studio/editor';
import {
  addTerrainLayer, addTerrainStroke, listUnifiedMapLayers,
  moveUnifiedMapLayer, removeTerrainLayer, updateTerrainLayer,
} from '../../domain/map-studio/terrain/terrain-document';
import type { TerrainLayer, TerrainStroke, TerrainViewport } from '../../domain/map-studio/terrain/terrain-types';
import type { MapGridType } from '../../domain/map-studio/grid-engine';
import { MapCanvas, type MapCanvasHandle } from '../components/map-studio/map-canvas';
import { TerrainToolPanel } from '../components/map-studio/terrain-tool-panel';
import { clampTerrainPoint, isScreenPointInsideViewport, isTerrainPointInsideMap, screenToMapPoint, useTerrainTool, viewportScale } from '../components/map-studio/use-terrain-tool';
import { InspectorPanel, LayersPanel } from '../components/map-studio/workspace-panels';
import { StatusBar, ToolDock, WorkspaceTopbar, type MapSaveState, type MapTool } from '../components/map-studio/workspace-chrome';
import { patchJson } from '../api/client';

interface MapStudioEditorProps {
  mapId: string;
  mapName: string;
  width: number;
  height: number;
  gridType: MapGridType;
  gridSize: number;
  backgroundUrl: string | null;
  initialDocument: MapEditorDocument;
  initialVersion: number;
  archived: boolean;
  documentSettings: (onGridPreviewChange: (preview: MapGridPreview) => void) => ReactNode;
}

export interface MapGridPreview { type: MapGridType; size: number }

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
  const [activeLayerId, setActiveLayerId] = useState<string | null>(listUnifiedMapLayers(initialDocument).at(-1)?.id ?? null);
  const [tool, setTool] = useState<MapTool>('SELECT');
  const [toolPanelKind, setToolPanelKind] = useState<'LAYERS' | 'TERRAIN'>('LAYERS');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveState, setSaveState] = useState<MapSaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const [toolPanelOpen, setToolPanelOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [inspectorOpen, setInspectorOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [focusMode, setFocusMode] = useState(false);
  const [gridPreviewOverride, setGridPreviewOverride] = useState<MapGridPreview | null>(null);
  const mapStateRef = useRef(mapState);
  const versionRef = useRef(initialVersion);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);
  const canvasRef = useRef<MapCanvasHandle>(null);
  const panelSnapshotRef = useRef({ toolPanelOpen: true, inspectorOpen: true });

  useEffect(() => { mapStateRef.current = mapState; }, [mapState]);
  const gridPreview = gridPreviewOverride ?? { type: gridType, size: gridSize };

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

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const viewport = useMemo<TerrainViewport>(() => ({
    x: pan.x + (width - viewWidth) / 2,
    y: pan.y + (height - viewHeight) / 2,
    width: viewWidth,
    height: viewHeight,
  }), [height, pan.x, pan.y, viewHeight, viewWidth, width]);

  const commitTerrainStroke = useCallback((layerId: string, stroke: TerrainStroke) => {
    commit((current) => addTerrainStroke(current, layerId, stroke));
  }, [commit]);

  const terrainTool = useTerrainTool({
    document: mapState,
    activeLayerId,
    archived,
    canvasRef,
    onCommitStroke: commitTerrainStroke,
  });

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

  const createTerrainLayer = () => {
    const id = crypto.randomUUID();
    const terrainCount = listUnifiedMapLayers(mapState).filter((candidate) => candidate.type === 'TERRAIN').length;
    const layer: TerrainLayer = {
      id,
      name: terrainCount === 0 ? 'Terrain Base' : `Terrain ${terrainCount + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      strokes: [],
    };
    commit((current) => addTerrainLayer(current, layer));
    setActiveLayerId(id);
    setTool('TERRAIN');
    setToolPanelKind('TERRAIN');
    setToolPanelOpen(true);
  };

  const selectTool = (nextTool: MapTool) => {
    setTool(nextTool);
    if (nextTool === 'TERRAIN') {
      setSelectedId(null);
      setToolPanelKind('TERRAIN');
      setToolPanelOpen(true);
    }
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (tool === 'PAN') {
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = { startClientX: event.clientX, startClientY: event.clientY, startX: pan.x, startY: pan.y };
    } else if (tool === 'TERRAIN') {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!isScreenPointInsideViewport(event.clientX, event.clientY, bounds, viewport)) return;
      const pressure = event.pointerType === 'mouse' ? 1 : Math.max(.05, event.pressure || 1);
      const point = screenToMapPoint(event.clientX, event.clientY, bounds, viewport, pressure);
      if (!isTerrainPointInsideMap(point, width, height)) return;
      if (terrainTool.begin(point)) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    } else if (!(event.target as Element).closest('[data-map-object]')) {
      setSelectedId(null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    canvasRef.current?.updateBrushCursor(event.clientX, event.clientY, true);
    if (panRef.current) {
      const scale = viewportScale(bounds, viewport);
      setPan({
        x: panRef.current.startX - (event.clientX - panRef.current.startClientX) / scale,
        y: panRef.current.startY - (event.clientY - panRef.current.startClientY) / scale,
      });
    }
    if (dragRef.current) {
      const scale = viewportScale(bounds, viewport);
      const drag = dragRef.current;
      setMapState((current) => updateMapObject(current, drag.objectId, {
        x: drag.startX + (event.clientX - drag.startClientX) / scale,
        y: drag.startY + (event.clientY - drag.startClientY) / scale,
      }));
    }
    if (tool === 'TERRAIN') {
      const pressure = event.pointerType === 'mouse' ? 1 : Math.max(.05, event.pressure || 1);
      const point = screenToMapPoint(event.clientX, event.clientY, bounds, viewport, pressure);
      terrainTool.add(clampTerrainPoint(point, width, height));
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (tool === 'TERRAIN') terrainTool.finish();
    dragRef.current = null;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (tool === 'TERRAIN') terrainTool.cancel();
    dragRef.current = null;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const updateSelected = (update: Partial<Omit<MapEditorObject, 'id' | 'type'>>) => {
    if (!selected) return;
    commit((current) => updateMapObject(current, selected.id, update));
  };

  const updateLayer = (layerId: string, update: Partial<Pick<MapEditorLayer, 'name' | 'visible' | 'locked'>>) => {
    commit((current) => updateMapLayer(current, layerId, update));
  };

  const updateTerrain = (layerId: string, update: Partial<Pick<TerrainLayer, 'name' | 'visible' | 'locked' | 'opacity'>>) => {
    commit((current) => updateTerrainLayer(current, layerId, update));
  };

  const deleteTerrain = (layerId: string) => {
    commit((current) => removeTerrainLayer(current, layerId));
    if (activeLayerId === layerId) {
      const remaining = listUnifiedMapLayers(removeTerrainLayer(mapStateRef.current, layerId));
      setActiveLayerId(remaining.at(-1)?.id ?? null);
    }
  };

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
          tool={tool} archived={archived} toolPanelOpen={toolPanelOpen} toolPanelKind={toolPanelKind} inspectorOpen={inspectorOpen}
          onToolChange={selectTool} onAddObject={addObject}
          onToggleToolPanel={() => setToolPanelOpen((open) => !open)}
          onShowLayers={() => {
            setToolPanelKind('LAYERS');
            setToolPanelOpen((open) => toolPanelKind === 'LAYERS' ? !open : true);
          }}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onShowSettings={() => { setSelectedId(null); setInspectorOpen(true); }}
        />
        {toolPanelOpen && toolPanelKind === 'LAYERS' && (
          <LayersPanel
            document={mapState} activeLayerId={activeLayerId} archived={archived}
            onClose={() => setToolPanelOpen(false)} onAddLayer={addLayer} onAddTerrainLayer={createTerrainLayer} onActivateLayer={setActiveLayerId}
            onUpdateLayer={updateLayer} onUpdateTerrainLayer={updateTerrain}
            onMoveLayer={(layerId, direction) => commit((current) => moveUnifiedMapLayer(current, layerId, direction))}
            onRemoveTerrainLayer={deleteTerrain}
          />
        )}
        {toolPanelOpen && toolPanelKind === 'TERRAIN' && (
          <TerrainToolPanel
            activeLayer={terrainTool.activeLayer} archived={archived} mode={terrainTool.mode}
            textureId={terrainTool.textureId} brush={terrainTool.brush} feedback={terrainTool.feedback}
            onClose={() => setToolPanelOpen(false)} onCreateLayer={createTerrainLayer}
            onModeChange={terrainTool.setMode} onTextureChange={terrainTool.selectTexture} onBrushChange={terrainTool.setBrush}
          />
        )}
        <MapCanvas
          ref={canvasRef}
          mapId={mapId} document={mapState} selected={selected} width={width} height={height}
          gridType={gridPreview.type} gridSize={gridPreview.size} backgroundUrl={backgroundUrl} tool={tool}
          viewport={viewport} brushSize={terrainTool.brush.size} brushHardness={terrainTool.brush.hardness}
          onObjectPointerDown={beginObjectDrag} onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove} onPointerFinish={finishPointer}
          onPointerCancel={cancelPointer}
          onPointerLeave={() => canvasRef.current?.updateBrushCursor(0, 0, false)}
        />
        {inspectorOpen && (
          <InspectorPanel
            selected={selected} selectedLayer={selectedLayer} archived={archived} onClose={() => setInspectorOpen(false)}
            settings={<div className="map-document-settings"><label>Fundo<input disabled={archived} type="color" value={mapState.backgroundColor} onChange={(event) => commit((current) => ({ ...current, backgroundColor: event.target.value }))}/></label>{documentSettings(setGridPreviewOverride)}</div>}
            onUpdateSelected={updateSelected}
            onRemoveSelected={() => { if (selected) commit((current) => removeMapObject(current, selected.id)); setSelectedId(null); }}
          />
        )}
        {saveState === 'error' && (
          <div className="map-save-error" role="alert"><AlertTriangle size={17}/><span>{saveError}</span><button type="button" onClick={() => void save()}><RotateCcw size={15}/>Tentar novamente</button></div>
        )}
      </div>
      <StatusBar width={width} height={height} gridType={gridPreview.type} zoom={zoom} saveLabel={saveLabel}/>
    </section>
  );
}
