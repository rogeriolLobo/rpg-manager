import { Archive, Copy, Link2, Map, Plus, RotateCcw, Save, Trash2, Unlink, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import type { MapEditorDocument } from '../../domain/map-studio/editor';
import { Empty, PageHeader } from './dashboard-page';
import { MapStudioEditor } from './map-studio-editor';

const MAP_TYPES = ['GENERIC', 'GEOGRAPHIC', 'SETTLEMENT', 'INTERIOR', 'TACTICAL', 'HEX', 'SPACE', 'NETWORK', 'ABSTRACT', 'IMPORTED'] as const;
const GRID_TYPES = ['NONE', 'SQUARE', 'HEX_POINTY', 'HEX_FLAT'] as const;

type MapType = typeof MAP_TYPES[number];
type GridType = typeof GRID_TYPES[number];

interface MapDocument {
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
  worldIds: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MapDetail extends MapDocument {
  worlds: Array<{ id: string; name: string }>;
}

interface WorldOption {
  id: string;
  name: string;
}

const typeLabel: Record<MapType, string> = {
  GENERIC: 'Genérico',
  GEOGRAPHIC: 'Geográfico',
  SETTLEMENT: 'Assentamento',
  INTERIOR: 'Interior',
  TACTICAL: 'Tático',
  HEX: 'Hexagonal',
  SPACE: 'Espacial',
  NETWORK: 'Rede',
  ABSTRACT: 'Abstrato',
  IMPORTED: 'Importado',
};

const gridLabel: Record<GridType, string> = {
  NONE: 'Sem grade',
  SQUARE: 'Quadrada',
  HEX_POINTY: 'Hexagonal (ponta)',
  HEX_FLAT: 'Hexagonal (topo)',
};

const blankForm = {
  name: '',
  description: '',
  mapType: 'GENERIC' as MapType,
  width: '1920',
  height: '1080',
  gridType: 'NONE' as GridType,
  gridSize: '50',
};

type MapForm = typeof blankForm;

function mapPayload(form: MapForm, backgroundAssetId: string | null) {
  return {
    name: form.name,
    description: form.description,
    mapType: form.mapType,
    width: Number(form.width),
    height: Number(form.height),
    gridType: form.gridType,
    gridSize: Number(form.gridSize),
    backgroundAssetId,
  };
}

function formFromMap(item: MapDocument): MapForm {
  return {
    name: item.name,
    description: item.description,
    mapType: item.mapType,
    width: String(item.width),
    height: String(item.height),
    gridType: item.gridType,
    gridSize: String(item.gridSize),
  };
}

async function uploadImage(file: File): Promise<string> {
  const data = new FormData();
  data.set('file', file, file.name);
  data.set('filename', file.name);
  const result = await api<{ item: { id: string } }>('/files', { method: 'POST', body: data });
  return result.item.id;
}

export function MapStudioPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const worldId = params.get('worldId') ?? '';
  const q = params.get('q') ?? '';
  const showArchived = params.get('archived') === '1';
  const query = new URLSearchParams();
  if (worldId) query.set('worldId', worldId);
  if (q) query.set('q', q);
  if (showArchived) query.set('archived', '1');

  const resource = useResource<{ items: MapDocument[] }>(`/maps${query.size ? `?${query}` : ''}`);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [form, setForm] = useState(blankForm);
  const [file, setFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<{ items: WorldOption[] }>('/worlds?pageSize=50')
      .then((result) => setWorlds(result.items))
      .catch(() => setWorlds([]));
  }, []);

  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    let assetId: string | null = null;
    try {
      if (file) assetId = await uploadImage(file);
      const effective = {
        ...form,
        mapType: file && form.mapType === 'GENERIC' ? 'IMPORTED' as MapType : form.mapType,
      };
      const created = await postJson<{ item: MapDocument }>('/maps', mapPayload(effective, assetId));
      setForm(blankForm);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      navigate(`/app/maps/${created.item.id}`);
    } catch (reason) {
      if (assetId) {
        try {
          await deleteApi(`/files/${assetId}`);
        } catch {
          // Best effort: o asset continua user-owned e pode ser removido depois pelo gerenciador de arquivos.
        }
      }
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar o mapa.');
    } finally {
      setCreating(false);
    }
  };

  const duplicate = async (mapId: string) => {
    setError('');
    try {
      const result = await postJson<{ id: string }>(`/maps/${mapId}/duplicate`, {});
      navigate(`/app/maps/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o mapa.');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Map Studio"
        title="Meus mapas"
        description="Mapas pertencem a você. Worlds são contextos opcionais; o VTT continua uma experiência independente."
      />

      <div className="panel map-studio-toolbar">
        <label>
          Buscar
          <input
            value={q}
            placeholder="Nome ou descrição"
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('q', event.target.value);
              else next.delete('q');
              setParams(next, { replace: true });
            }}
          />
        </label>
        <label>
          Filtrar por World
          <select
            value={worldId}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('worldId', event.target.value);
              else next.delete('worldId');
              setParams(next);
            }}
          >
            <option value="">Todos os mapas</option>
            {worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
          </select>
        </label>
        <label className="checkbox-row map-studio-archive-filter">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.checked) next.set('archived', '1');
              else next.delete('archived');
              setParams(next);
            }}
          />
          Incluir arquivados
        </label>
      </div>

      {resource.data.items.length === 0 ? (
        <Empty
          title="Nenhum mapa encontrado"
          text="Crie um mapa vazio ou importe uma imagem. Nenhum World é necessário."
          action="Ver Worlds"
          to="/app/worlds"
        />
      ) : (
        <div className="map-studio-grid">
          {resource.data.items.map((map) => (
            <article key={map.id} className="panel map-studio-card">
              <Link to={`/app/maps/${map.id}`} className="map-studio-preview">
                {map.backgroundUrl ? <img src={map.backgroundUrl} alt=""/> : <span><Map size={36}/>Mapa vazio</span>}
              </Link>
              <div>
                <Link to={`/app/maps/${map.id}`}><strong>{map.name}</strong></Link>
                <p>{typeLabel[map.mapType]} · {map.width}×{map.height}{map.archivedAt ? ' · Arquivado' : ''}</p>
                {map.worldIds.length > 0 && (
                  <small>{map.worldIds.length} World{map.worldIds.length > 1 ? 's' : ''} vinculado{map.worldIds.length > 1 ? 's' : ''}</small>
                )}
              </div>
              <button className="ghost-button" type="button" onClick={() => void duplicate(map.id)}>
                <Copy size={15}/>Duplicar
              </button>
            </article>
          ))}
        </div>
      )}

      <form className="panel form-grid" onSubmit={(event) => void create(event)}>
        <h2 className="span-2"><Plus size={19}/>Novo mapa</h2>
        <label className="span-2">
          Nome
          <input required maxLength={160} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}/>
        </label>
        <label className="span-2">
          Descrição
          <textarea rows={2} maxLength={4000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/>
        </label>
        <label>
          Tipo
          <select value={form.mapType} onChange={(event) => setForm((current) => ({ ...current, mapType: event.target.value as MapType }))}>
            {MAP_TYPES.map((type) => <option key={type} value={type}>{typeLabel[type]}</option>)}
          </select>
        </label>
        <label>
          Imagem opcional
          <span className="secondary-button link-button map-file-button">
            <Upload size={16}/>{file ? file.name : 'Importar imagem'}
            <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/>
          </span>
        </label>
        <label>
          Largura
          <input required type="number" min={64} max={32768} value={form.width} onChange={(event) => setForm((current) => ({ ...current, width: event.target.value }))}/>
        </label>
        <label>
          Altura
          <input required type="number" min={64} max={32768} value={form.height} onChange={(event) => setForm((current) => ({ ...current, height: event.target.value }))}/>
        </label>
        <label>
          Grade
          <select value={form.gridType} onChange={(event) => setForm((current) => ({ ...current, gridType: event.target.value as GridType }))}>
            {GRID_TYPES.map((type) => <option key={type} value={type}>{gridLabel[type]}</option>)}
          </select>
        </label>
        <label>
          Tamanho da grade
          <input type="number" min={4} max={512} value={form.gridSize} onChange={(event) => setForm((current) => ({ ...current, gridSize: event.target.value }))}/>
        </label>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button className="primary-button" disabled={creating}><Plus size={17}/>{creating ? 'Criando…' : 'Criar mapa'}</button>
        </div>
      </form>
    </div>
  );
}

interface MapStudioDetailEditorProps {
  item: MapDetail;
  mapId: string;
  worlds: WorldOption[];
  reload: () => void;
}

function MapStudioDetailEditor({ item, mapId, worlds, reload }: MapStudioDetailEditorProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState(() => formFromMap(item));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const linkedIds = new Set(item.worlds.map((world) => world.id));
  const archived = Boolean(item.archivedAt);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadImage(file);
      await patchJson(`/maps/${mapId}`, mapPayload(form, uploaded ?? item.backgroundAssetId));
      setFile(null);
      reload();
    } catch (reason) {
      if (uploaded) {
        try {
          await deleteApi(`/files/${uploaded}`);
        } catch {
          // Best effort: o asset continua user-owned e pode ser removido depois pelo gerenciador de arquivos.
        }
      }
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o mapa.');
    } finally {
      setSaving(false);
    }
  };

  const toggleWorld = async (worldId: string, checked: boolean) => {
    setError('');
    try {
      if (checked) await postJson(`/maps/${mapId}/worlds/${worldId}`, {});
      else await deleteApi(`/maps/${mapId}/worlds/${worldId}`);
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o vínculo.');
    }
  };

  const toggleArchive = async () => {
    setError('');
    try {
      await postJson(`/maps/${mapId}/${archived ? 'restore' : 'archive'}`, {});
      reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível alterar o arquivamento.');
    }
  };

  const duplicate = async () => {
    try {
      const result = await postJson<{ id: string }>(`/maps/${mapId}/duplicate`, {});
      navigate(`/app/maps/${result.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar.');
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir o mapa "${item.name}"? Os Worlds vinculados não serão excluídos.`)) return;
    try {
      await deleteApi(`/maps/${mapId}`);
      navigate('/app/maps');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir.');
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Map Studio"
        title={item.name}
        description="Documento de criação independente. Vínculos com Worlds são apenas contexto opcional."
      />

      <MapStudioEditor
        mapId={mapId}
        width={item.width}
        height={item.height}
        gridType={item.gridType}
        gridSize={item.gridSize}
        backgroundUrl={item.backgroundUrl}
        initialDocument={item.document}
        initialVersion={item.documentVersion}
        archived={archived}
      />

      <div className="map-studio-detail-layout map-studio-settings-layout">
        <section className="panel">
          <h2><Link2 size={18}/>Worlds opcionais</h2>
          <p className="section-note">Um mapa pode estar em zero, um ou vários Worlds.</p>
          <div className="map-world-links">
            {worlds.map((world) => (
              <label key={world.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={linkedIds.has(world.id)}
                  disabled={archived}
                  onChange={(event) => void toggleWorld(world.id, event.target.checked)}
                />
                {world.name}
              </label>
            ))}
          </div>
          {worlds.length === 0 && <p>Nenhum World disponível. O mapa continua utilizável.</p>}
        </section>
      </div>

      <form className="panel form-grid" onSubmit={(event) => void save(event)}>
        <h2 className="span-2"><Save size={18}/>Metadados</h2>
        {archived && <p className="section-note span-2">Este mapa está arquivado. Restaure-o para editar metadados ou vínculos.</p>}
        <label className="span-2">
          Nome
          <input disabled={archived} required maxLength={160} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}/>
        </label>
        <label className="span-2">
          Descrição
          <textarea disabled={archived} rows={3} maxLength={4000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/>
        </label>
        <label>
          Tipo
          <select disabled={archived} value={form.mapType} onChange={(event) => setForm((current) => ({ ...current, mapType: event.target.value as MapType }))}>
            {MAP_TYPES.map((type) => <option key={type} value={type}>{typeLabel[type]}</option>)}
          </select>
        </label>
        <label>
          Trocar imagem
          <span className="secondary-button link-button map-file-button">
            <Upload size={16}/>{file ? file.name : 'Selecionar imagem'}
            <input disabled={archived} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)}/>
          </span>
        </label>
        <label>
          Largura
          <input disabled={archived} required type="number" min={64} max={32768} value={form.width} onChange={(event) => setForm((current) => ({ ...current, width: event.target.value }))}/>
        </label>
        <label>
          Altura
          <input disabled={archived} required type="number" min={64} max={32768} value={form.height} onChange={(event) => setForm((current) => ({ ...current, height: event.target.value }))}/>
        </label>
        <label>
          Grade
          <select disabled={archived} value={form.gridType} onChange={(event) => setForm((current) => ({ ...current, gridType: event.target.value as GridType }))}>
            {GRID_TYPES.map((type) => <option key={type} value={type}>{gridLabel[type]}</option>)}
          </select>
        </label>
        <label>
          Tamanho
          <input disabled={archived} type="number" min={4} max={512} value={form.gridSize} onChange={(event) => setForm((current) => ({ ...current, gridSize: event.target.value }))}/>
        </label>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button className="primary-button" disabled={saving || archived}><Save size={16}/>{saving ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" className="secondary-button" onClick={() => void duplicate()}><Copy size={16}/>Duplicar</button>
          <button type="button" className="secondary-button" onClick={() => void toggleArchive()}>
            {archived ? <RotateCcw size={16}/> : <Archive size={16}/>}
            {archived ? 'Restaurar' : 'Arquivar'}
          </button>
          <button type="button" className="ghost-button" onClick={() => void remove()}><Trash2 size={16}/>Excluir</button>
        </div>
      </form>

      <p><Link to="/app/maps"><Unlink size={14}/> Voltar para todos os mapas</Link></p>
    </div>
  );
}

export function MapStudioDetailPage() {
  const { mapId } = useParams();
  const resource = useResource<{ item: MapDetail }>(mapId ? `/maps/${mapId}` : null);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);

  useEffect(() => {
    void api<{ items: WorldOption[] }>('/worlds?pageSize=50')
      .then((result) => setWorlds(result.items))
      .catch(() => setWorlds([]));
  }, []);

  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  if (!mapId) return null;

  const item = resource.data.item;
  return (
    <MapStudioDetailEditor
      key={`${item.id}:${item.updatedAt}:${item.backgroundAssetId ?? ''}`}
      item={item}
      mapId={mapId}
      worlds={worlds}
      reload={resource.reload}
    />
  );
}
