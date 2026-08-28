import { Archive, Copy, Link2, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MapEditorDocument } from '../../domain/map-studio/editor';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { MapStudioEditor } from './map-studio-editor';

const MAP_TYPES = ['GENERIC', 'GEOGRAPHIC', 'SETTLEMENT', 'INTERIOR', 'TACTICAL', 'HEX', 'SPACE', 'NETWORK', 'ABSTRACT', 'IMPORTED'] as const;
const GRID_TYPES = ['NONE', 'SQUARE', 'HEX_POINTY', 'HEX_FLAT'] as const;
type MapType = typeof MAP_TYPES[number];
type GridType = typeof GRID_TYPES[number];

interface MapDetail {
  id: string;
  name: string;
  description: string;
  mapType: MapType;
  width: number;
  height: number;
  gridType: GridType;
  gridSize: number;
  document: MapEditorDocument;
  documentVersion: number;
  backgroundAssetId: string | null;
  backgroundUrl: string | null;
  worlds: Array<{ id: string; name: string }>;
  archivedAt: string | null;
}

interface WorldOption { id: string; name: string }

const typeLabel: Record<MapType, string> = {
  GENERIC: 'Genérico', GEOGRAPHIC: 'Geográfico', SETTLEMENT: 'Assentamento', INTERIOR: 'Interior',
  TACTICAL: 'Tático', HEX: 'Hexagonal', SPACE: 'Espacial', NETWORK: 'Rede', ABSTRACT: 'Abstrato', IMPORTED: 'Importado',
};
const gridLabel: Record<GridType, string> = {
  NONE: 'Sem grade', SQUARE: 'Quadrada', HEX_POINTY: 'Hexagonal (ponta)', HEX_FLAT: 'Hexagonal (topo)',
};

function formFromMap(item: MapDetail) {
  return {
    name: item.name, description: item.description, mapType: item.mapType,
    width: String(item.width), height: String(item.height), gridType: item.gridType, gridSize: String(item.gridSize),
  };
}

async function uploadImage(file: File): Promise<string> {
  const data = new FormData();
  data.set('file', file, file.name);
  data.set('filename', file.name);
  const result = await api<{ item: { id: string } }>('/files', { method: 'POST', body: data });
  return result.item.id;
}

interface DocumentSettingsProps {
  item: MapDetail;
  worlds: WorldOption[];
  reload: () => void;
}

function DocumentSettings({ item, worlds, reload }: DocumentSettingsProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => formFromMap(item));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const linkedIds = new Set(item.worlds.map((world) => world.id));
  const archived = Boolean(item.archivedAt);

  const saveMetadata = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadImage(file);
      await patchJson(`/maps/${item.id}`, {
        name: form.name, description: form.description, mapType: form.mapType,
        width: Number(form.width), height: Number(form.height), gridType: form.gridType,
        gridSize: Number(form.gridSize), backgroundAssetId: uploaded ?? item.backgroundAssetId,
      });
      setFile(null);
      reload();
    } catch (reason) {
      if (uploaded) {
        try { await deleteApi(`/files/${uploaded}`); } catch { /* asset continua user-owned */ }
      }
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os detalhes do mapa.');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorld = async (worldId: string, checked: boolean) => {
    setError('');
    try {
      if (checked) await postJson(`/maps/${item.id}/worlds/${worldId}`, {});
      else await deleteApi(`/maps/${item.id}/worlds/${worldId}`);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o contexto de World.');
    }
  };

  const duplicate = async () => {
    try {
      const result = await postJson<{ id: string }>(`/maps/${item.id}/duplicate`, {});
      navigate(`/app/maps/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o mapa.');
    }
  };

  const toggleArchive = async () => {
    try {
      await postJson(`/maps/${item.id}/${archived ? 'restore' : 'archive'}`, {});
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o arquivamento.');
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir o mapa "${item.name}"? Os Worlds vinculados não serão excluídos.`)) return;
    try {
      await deleteApi(`/maps/${item.id}`);
      navigate('/app/maps');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o mapa.');
    }
  };

  return (
    <form className="map-settings-form" onSubmit={(event) => void saveMetadata(event)}>
      {archived && <p className="section-note">Mapa arquivado. Restaure para editar.</p>}
      <label>Nome<input disabled={archived} required maxLength={160} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}/></label>
      <label>Descrição<textarea disabled={archived} rows={3} maxLength={4000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/></label>
      <label>Tipo<select disabled={archived} value={form.mapType} onChange={(event) => setForm((current) => ({ ...current, mapType: event.target.value as MapType }))}>{MAP_TYPES.map((type) => <option key={type} value={type}>{typeLabel[type]}</option>)}</select></label>
      <div className="map-settings-pair">
        <label>Largura<input disabled={archived} required type="number" min={64} max={32768} value={form.width} onChange={(event) => setForm((current) => ({ ...current, width: event.target.value }))}/></label>
        <label>Altura<input disabled={archived} required type="number" min={64} max={32768} value={form.height} onChange={(event) => setForm((current) => ({ ...current, height: event.target.value }))}/></label>
      </div>
      <div className="map-settings-pair">
        <label>Grade<select disabled={archived} value={form.gridType} onChange={(event) => setForm((current) => ({ ...current, gridType: event.target.value as GridType }))}>{GRID_TYPES.map((type) => <option key={type} value={type}>{gridLabel[type]}</option>)}</select></label>
        <label>Tamanho<input disabled={archived} type="number" min={4} max={512} value={form.gridSize} onChange={(event) => setForm((current) => ({ ...current, gridSize: event.target.value }))}/></label>
      </div>
      <label>Imagem de fundo<span className="map-workspace-file"><Upload size={15}/>{file ? file.name : 'Selecionar imagem'}<input disabled={archived} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></span></label>
      <details className="map-world-settings">
        <summary><Link2 size={15}/>Worlds opcionais <small>{linkedIds.size}</small></summary>
        <p className="section-note">World é somente contexto; o mapa funciona sem vínculo.</p>
        <div className="map-world-links">
          {worlds.map((world) => <label key={world.id} className="checkbox-row"><input type="checkbox" checked={linkedIds.has(world.id)} disabled={archived} onChange={(event) => void toggleWorld(world.id, event.target.checked)}/>{world.name}</label>)}
          {worlds.length === 0 && <p>Nenhum World disponível. O mapa continua utilizável.</p>}
        </div>
      </details>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="map-panel-primary" disabled={saving || archived}><Save size={15}/>{saving ? 'Salvando…' : 'Salvar detalhes'}</button>
      <div className="map-settings-actions">
        <button type="button" onClick={() => void duplicate()}><Copy size={15}/>Duplicar</button>
        <button type="button" onClick={() => void toggleArchive()}>{archived ? <RotateCcw size={15}/> : <Archive size={15}/>}{archived ? 'Restaurar' : 'Arquivar'}</button>
        <button type="button" className="danger" onClick={() => void remove()}><Trash2 size={15}/>Excluir</button>
      </div>
    </form>
  );
}

export function MapStudioWorkspacePage() {
  const { mapId } = useParams();
  const resource = useResource<{ item: MapDetail }>(mapId ? `/maps/${mapId}` : null);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);

  useEffect(() => {
    void api<{ items: WorldOption[] }>('/worlds?pageSize=50').then((result) => setWorlds(result.items)).catch(() => setWorlds([]));
  }, []);

  if (resource.status !== 'success') return <div className="map-workspace-fallback"><ResourceFallback state={resource} onRetry={resource.reload}/></div>;
  if (!mapId) return null;
  const item = resource.data.item;

  return (
    <MapStudioEditor
      mapId={mapId} mapName={item.name} width={item.width} height={item.height}
      gridType={item.gridType} gridSize={item.gridSize} backgroundUrl={item.backgroundUrl}
      initialDocument={item.document} initialVersion={item.documentVersion} archived={Boolean(item.archivedAt)}
      documentSettings={<DocumentSettings item={item} worlds={worlds} reload={resource.reload}/>}
    />
  );
}
