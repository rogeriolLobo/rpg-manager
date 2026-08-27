import {
  AlertTriangle, ArrowDown, ArrowUp, Box, Circle, Eye, EyeOff, Hand, Layers,
  Lock, Maximize2, MousePointer2, Redo2, RotateCcw, Save, Type, Undo2, Unlock,
  ZoomIn, ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  addMapLayer, addMapObject, cloneMapDocument, findMapObject, findObjectLayer,
  moveMapLayer, removeMapObject, updateMapLayer, updateMapObject,
  type MapEditorDocument, type MapEditorObject,
} from '../../domain/map-studio/editor';
import { patchJson } from '../api/client';

interface MapStudioEditorProps {
  mapId: string;
  width: number;
  height: number;
  gridType: 'NONE' | 'SQUARE' | 'HEX_POINTY' | 'HEX_FLAT';
  gridSize: number;
  backgroundUrl: string | null;
  initialDocument: MapEditorDocument;
  initialVersion: number;
  archived: boolean;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type Tool = 'SELECT' | 'PAN';

interface SaveResponse { success: true; version: number; updatedAt: string }
interface DragState { objectId: string; startClientX: number; startClientY: number; startX: number; startY: number }
interface PanState { startClientX: number; startClientY: number; startX: number; startY: number }

const HISTORY_LIMIT = 60;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function MapStudioEditor({
  mapId, width, height, gridType, gridSize, backgroundUrl, initialDocument, initialVersion, archived,
}: MapStudioEditorProps) {
  const [mapState, setMapState] = useState(() => cloneMapDocument(initialDocument));
  const [past, setPast] = useState<MapEditorDocument[]>([]);
  const [future, setFuture] = useState<MapEditorDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(initialDocument.layers.at(-1)?.id ?? null);
  const [tool, setTool] = useState<Tool>('SELECT');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState('');
  const mapStateRef = useRef(mapState);
  const versionRef = useRef(initialVersion);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);

  useEffect(() => { mapStateRef.current = mapState; }, [mapState]);

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

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingField = target?.matches('input,textarea,select,[contenteditable="true"]');
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
  }, [archived, commit, redo, save, selected, undo]);

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
      id: crypto.randomUUID(), type, x: Math.round(width * 0.35), y: Math.round(height * 0.35),
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

  const viewWidth = width / zoom;
  const viewHeight = height / zoom;
  const viewX = pan.x + (width - viewWidth) / 2;
  const viewY = pan.y + (height - viewHeight) / 2;
  const saveLabel = saveState === 'saving' ? 'Salvando…' : saveState === 'dirty' ? 'Alterações pendentes' : saveState === 'error' ? 'Falha ao salvar' : 'Salvo';

  return (
    <section className="panel map-editor" aria-label="Editor do mapa">
      <div className="map-editor-toolbar" role="toolbar" aria-label="Ferramentas do mapa">
        <button type="button" className={tool === 'SELECT' ? 'active' : ''} onClick={() => setTool('SELECT')}><MousePointer2 size={16}/>Selecionar</button>
        <button type="button" className={tool === 'PAN' ? 'active' : ''} onClick={() => setTool('PAN')}><Hand size={16}/>Mover tela</button>
        <button type="button" disabled={archived} onClick={() => addObject('RECTANGLE')}><Box size={16}/>Retângulo</button>
        <button type="button" disabled={archived} onClick={() => addObject('ELLIPSE')}><Circle size={16}/>Elipse</button>
        <button type="button" disabled={archived} onClick={() => addObject('TEXT')}><Type size={16}/>Texto</button>
        <button type="button" disabled={!past.length || archived} onClick={undo}><Undo2 size={16}/>Desfazer</button>
        <button type="button" disabled={!future.length || archived} onClick={redo}><Redo2 size={16}/>Refazer</button>
        <button type="button" onClick={() => setZoom((value) => clamp(value - .25, .25, 4))}><ZoomOut size={16}/></button>
        <span aria-label="Zoom atual">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => clamp(value + .25, .25, 4))}><ZoomIn size={16}/></button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}><Maximize2 size={16}/>Ajustar</button>
        <button type="button" disabled={saveState === 'saving' || archived} onClick={() => void save()}><Save size={16}/>Salvar agora</button>
        <span className={`map-save-state ${saveState}`} aria-live="polite">{saveLabel}</span>
      </div>

      {saveState === 'error' && (
        <div className="map-save-error" role="alert"><AlertTriangle size={17}/><span>{saveError}</span><button type="button" onClick={() => void save()}><RotateCcw size={15}/>Tentar novamente</button></div>
      )}

      <div className="map-editor-layout">
        <aside className="map-layers-panel">
          <div className="section-heading"><h3><Layers size={17}/>Camadas</h3><button type="button" disabled={archived} onClick={addLayer}>+ Camada</button></div>
          {[...mapState.layers].reverse().map((layer) => (
            <div key={layer.id} className={`map-layer-row ${activeLayerId === layer.id ? 'active' : ''}`}>
              <button type="button" className="map-layer-name" onClick={() => setActiveLayerId(layer.id)}>{layer.name}</button>
              <button type="button" aria-label={`${layer.visible ? 'Ocultar' : 'Mostrar'} ${layer.name}`} onClick={() => commit((current) => updateMapLayer(current, layer.id, { visible: !layer.visible }))}>{layer.visible ? <Eye size={14}/> : <EyeOff size={14}/>}</button>
              <button type="button" aria-label={`${layer.locked ? 'Desbloquear' : 'Bloquear'} ${layer.name}`} onClick={() => commit((current) => updateMapLayer(current, layer.id, { locked: !layer.locked }))}>{layer.locked ? <Lock size={14}/> : <Unlock size={14}/>}</button>
              <button type="button" aria-label={`Subir ${layer.name}`} onClick={() => commit((current) => moveMapLayer(current, layer.id, 1))}><ArrowUp size={14}/></button>
              <button type="button" aria-label={`Descer ${layer.name}`} onClick={() => commit((current) => moveMapLayer(current, layer.id, -1))}><ArrowDown size={14}/></button>
            </div>
          ))}
          {!mapState.layers.length && <p className="section-note">Adicione uma camada ou um objeto para começar.</p>}
          <label>Fundo<input disabled={archived} type="color" value={mapState.backgroundColor} onChange={(event) => commit((current) => ({ ...current, backgroundColor: event.target.value }))}/></label>
        </aside>

        <div className={`map-canvas-viewport ${tool === 'PAN' ? 'is-panning' : ''}`}>
          <svg
            role="img"
            aria-label="Canvas do mapa"
            viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={finishPointer}
          >
            <defs>
              <pattern id={`grid-${mapId}`} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="rgba(40,40,40,.22)" strokeWidth={Math.max(1, gridSize / 40)}/>
              </pattern>
            </defs>
            <rect x="0" y="0" width={width} height={height} fill={mapState.backgroundColor}/>
            {backgroundUrl && <image href={backgroundUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="xMidYMid slice"/>}
            {gridType !== 'NONE' && <rect x="0" y="0" width={width} height={height} fill={`url(#grid-${mapId})`}/>}
            {mapState.layers.map((layer) => layer.visible && (
              <g key={layer.id} opacity={layer.locked ? .72 : 1}>
                {layer.objects.map((object) => {
                  const transform = `rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`;
                  const common = { transform, onPointerDown: (event: ReactPointerEvent<SVGElement>) => beginObjectDrag(event, object) };
                  if (object.type === 'ELLIPSE') return <ellipse key={object.id} {...common} cx={object.x + object.width / 2} cy={object.y + object.height / 2} rx={object.width / 2} ry={object.height / 2} fill={object.fill}/>;
                  if (object.type === 'TEXT') return <text key={object.id} {...common} x={object.x} y={object.y + object.height * .72} fill={object.fill} fontSize={Math.max(14, object.height * .55)}>{object.text || 'Texto'}</text>;
                  return <rect key={object.id} {...common} x={object.x} y={object.y} width={object.width} height={object.height} rx={8} fill={object.fill}/>;
                })}
              </g>
            ))}
            {selected && (
              <rect x={selected.x} y={selected.y} width={selected.width} height={selected.height} transform={`rotate(${selected.rotation} ${selected.x + selected.width / 2} ${selected.y + selected.height / 2})`} fill="none" stroke="#d47b2a" strokeWidth={Math.max(2, width / 700)} strokeDasharray="12 8" pointerEvents="none"/>
            )}
          </svg>
        </div>

        <aside className="map-inspector-panel">
          <h3>Seleção</h3>
          {selected ? (
            <div className="map-inspector-grid">
              <strong>{selected.type}</strong>
              {selectedLayer?.locked && <p className="section-note">A camada está bloqueada.</p>}
              <label>X<input disabled={archived || selectedLayer?.locked} type="number" value={Math.round(selected.x)} onChange={(event) => updateSelected({ x: numeric(event.target.value, selected.x) })}/></label>
              <label>Y<input disabled={archived || selectedLayer?.locked} type="number" value={Math.round(selected.y)} onChange={(event) => updateSelected({ y: numeric(event.target.value, selected.y) })}/></label>
              <label>Largura<input disabled={archived || selectedLayer?.locked} min={4} type="number" value={Math.round(selected.width)} onChange={(event) => updateSelected({ width: Math.max(4, numeric(event.target.value, selected.width)) })}/></label>
              <label>Altura<input disabled={archived || selectedLayer?.locked} min={4} type="number" value={Math.round(selected.height)} onChange={(event) => updateSelected({ height: Math.max(4, numeric(event.target.value, selected.height)) })}/></label>
              <label>Rotação<input disabled={archived || selectedLayer?.locked} type="number" value={Math.round(selected.rotation)} onChange={(event) => updateSelected({ rotation: numeric(event.target.value, selected.rotation) })}/></label>
              <label>Cor<input disabled={archived || selectedLayer?.locked} type="color" value={selected.fill} onChange={(event) => updateSelected({ fill: event.target.value })}/></label>
              {selected.type === 'TEXT' && <label className="span-2">Texto<input disabled={archived || selectedLayer?.locked} maxLength={500} value={selected.text} onChange={(event) => updateSelected({ text: event.target.value })}/></label>}
              <button type="button" disabled={archived || selectedLayer?.locked} onClick={() => { commit((current) => removeMapObject(current, selected.id)); setSelectedId(null); }}>Remover objeto</button>
            </div>
          ) : <p className="section-note">Selecione um objeto no canvas. Arraste para mover; use os campos para redimensionar e rotacionar.</p>}
        </aside>
      </div>
    </section>
  );
}
