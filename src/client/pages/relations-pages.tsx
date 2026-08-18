import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { GitFork, List, Plus, RotateCcw, Search, Trash2, UsersRound } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { RELATION_TYPES, type RelationDirection, type RelationType } from '../../domain/content/types';
import { deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { displayLabel } from '../labels';
import { Empty, PageHeader } from './dashboard-page';

interface RelationNodeData {
  id: string;
  name: string;
  entityType: string;
  visibility: string;
}

interface RelationItem {
  id: string;
  worldId: string;
  source: Pick<RelationNodeData, 'id' | 'name' | 'entityType'>;
  target: Pick<RelationNodeData, 'id' | 'name' | 'entityType'>;
  relationType: RelationType;
  label: string;
  description: string;
  direction: RelationDirection;
  visibility: string;
  strength: number | null;
  archivedAt: string | null;
}

interface RelationsData {
  world: { id: string; name: string; isOwner: boolean };
  nodes: RelationNodeData[];
  relations: RelationItem[];
}

type ViewMode = 'graph' | 'list' | 'genealogy';

interface RelationDraft {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: RelationType;
  label: string;
  description: string;
  direction: RelationDirection;
  visibility: 'PRIVATE' | 'GROUP' | 'CAMPAIGN' | 'PLAYERS' | 'GM_ONLY';
  strength: string;
}

const emptyDraft = (nodes: RelationNodeData[]): RelationDraft => ({
  sourceEntityId: nodes[0]?.id ?? '',
  targetEntityId: nodes[1]?.id ?? '',
  relationType: 'ALLY',
  label: '',
  description: '',
  direction: 'BIDIRECTIONAL',
  visibility: 'PRIVATE',
  strength: '',
});

const genealogyTypes = new Set<RelationType>(['PARENT', 'CHILD', 'SIBLING', 'PARTNER']);

function relationTitle(relation: RelationItem): string {
  return relation.label || displayLabel(relation.relationType);
}

function genealogyLevels(nodes: RelationNodeData[], relations: RelationItem[]): Map<string, number> {
  const level = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const relation of relations) {
      if (relation.relationType !== 'PARENT' && relation.relationType !== 'CHILD') continue;
      const parentId = relation.relationType === 'PARENT' ? relation.source.id : relation.target.id;
      const childId = relation.relationType === 'PARENT' ? relation.target.id : relation.source.id;
      const nextLevel = Math.min(nodes.length, (level.get(parentId) ?? 0) + 1);
      if ((level.get(childId) ?? 0) < nextLevel) { level.set(childId, nextLevel); changed = true; }
    }
    if (!changed) break;
  }
  return level;
}

function graphElements(data: RelationsData, view: ViewMode, selectedNodeId: string | null) {
  const relations = view === 'genealogy' ? data.relations.filter((relation) => genealogyTypes.has(relation.relationType)) : data.relations;
  const connectedIds = new Set(relations.flatMap((relation) => [relation.source.id, relation.target.id]));
  const visibleNodes = view === 'genealogy' ? data.nodes.filter((node) => connectedIds.has(node.id)) : data.nodes;
  const neighbors = new Set<string>();
  if (selectedNodeId) {
    neighbors.add(selectedNodeId);
    relations.forEach((relation) => {
      if (relation.source.id === selectedNodeId) neighbors.add(relation.target.id);
      if (relation.target.id === selectedNodeId) neighbors.add(relation.source.id);
    });
  }
  const levels = view === 'genealogy' ? genealogyLevels(visibleNodes, relations) : new Map<string, number>();
  const levelIndexes = new Map<number, number>();
  const nodes: Node[] = visibleNodes.map((node, index) => {
    const level = levels.get(node.id) ?? 0;
    const levelIndex = levelIndexes.get(level) ?? 0;
    levelIndexes.set(level, levelIndex + 1);
    return {
      id: node.id,
      position: view === 'genealogy'
        ? { x: levelIndex * 230, y: level * 150 }
        : { x: (index % 5) * 220, y: Math.floor(index / 5) * 150 },
      data: { label: `${node.name} · ${displayLabel(node.entityType)}` },
      className: selectedNodeId && !neighbors.has(node.id) ? 'relation-node-dimmed' : 'relation-node',
    };
  });
  const edges: Edge[] = relations.map((relation) => ({
    id: relation.id,
    source: relation.source.id,
    target: relation.target.id,
    label: relationTitle(relation),
    markerEnd: relation.direction === 'DIRECTED' ? { type: MarkerType.ArrowClosed } : undefined,
    className: selectedNodeId && ![relation.source.id, relation.target.id].includes(selectedNodeId) ? 'relation-edge-dimmed' : '',
    animated: relation.relationType === 'SECRET',
    data: { relationId: relation.id },
  }));
  return { nodes, edges };
}

function RelationEditor({ worldId, nodes, relation, onSaved, onCancel }: {
  worldId: string;
  nodes: RelationNodeData[];
  relation: RelationItem | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RelationDraft>(() => relation ? {
    sourceEntityId: relation.source.id,
    targetEntityId: relation.target.id,
    relationType: relation.relationType,
    label: relation.label,
    description: relation.description,
    direction: relation.direction,
    visibility: relation.visibility as RelationDraft['visibility'],
    strength: relation.strength ? String(relation.strength) : '',
  } : emptyDraft(nodes));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const updateRelationType = (relationType: RelationType) => {
    const direction = ['PARENT', 'CHILD'].includes(relationType) ? 'DIRECTED'
      : ['SIBLING', 'PARTNER'].includes(relationType) ? 'BIDIRECTIONAL' : draft.direction;
    setDraft({ ...draft, relationType, direction });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    const payload = { ...draft, strength: draft.strength ? Number(draft.strength) : null };
    try {
      if (relation) await patchJson(`/relations/${relation.id}`, payload);
      else await postJson(`/relations/worlds/${worldId}`, payload);
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a relação.');
    } finally { setSaving(false); }
  };
  return <form className="panel relation-editor" onSubmit={submit}>
    <div className="section-heading"><div><span className="eyebrow">{relation ? 'Editar relação' : 'Nova relação'}</span><h2>{relation ? relationTitle(relation) : 'Conectar entidades'}</h2></div><button type="button" className="ghost-button" onClick={onCancel}>Fechar</button></div>
    <div className="form-grid">
      <label>Origem<select required value={draft.sourceEntityId} onChange={(event) => setDraft({ ...draft, sourceEntityId: event.target.value })}>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {displayLabel(node.entityType)}</option>)}</select></label>
      <label>Destino<select required value={draft.targetEntityId} onChange={(event) => setDraft({ ...draft, targetEntityId: event.target.value })}>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name} · {displayLabel(node.entityType)}</option>)}</select></label>
      <label>Tipo<select aria-label="Tipo da relação" value={draft.relationType} onChange={(event) => updateRelationType(event.target.value as RelationType)}>{RELATION_TYPES.map((type) => <option key={type} value={type}>{displayLabel(type)}</option>)}</select></label>
      <label>Direção<select value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value as RelationDirection })}><option value="DIRECTED">Direcionada</option><option value="BIDIRECTIONAL">Bidirecional</option></select></label>
      <label>Visibilidade<select value={draft.visibility} onChange={(event) => setDraft({ ...draft, visibility: event.target.value as RelationDraft['visibility'] })}><option value="PRIVATE">Privado</option><option value="GROUP">Grupo do World</option><option value="CAMPAIGN">Campanha comum</option><option value="PLAYERS">Jogadores da campanha</option><option value="GM_ONLY">Somente narrador</option></select></label>
      <label>Força<select value={draft.strength} onChange={(event) => setDraft({ ...draft, strength: event.target.value })}><option value="">Não definida</option>{[1, 2, 3, 4, 5].map((strength) => <option key={strength} value={strength}>{strength}</option>)}</select></label>
      <label className="span-2">Rótulo<input maxLength={160} required={draft.relationType === 'CUSTOM'} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Opcional, obrigatório para relação personalizada"/></label>
      <label className="span-2">Descrição<textarea rows={4} maxLength={4000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
      {error && <p className="form-error span-2">{error}</p>}
      <div className="form-actions span-2"><button type="button" className="ghost-button" onClick={onCancel}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'Salvando…' : 'Salvar relação'}</button></div>
    </div>
  </form>;
}

export function WorldRelationsPage() {
  const { id: worldId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = (['graph', 'list', 'genealogy'].includes(searchParams.get('view') ?? '') ? searchParams.get('view') : 'graph') as ViewMode;
  const search = searchParams.get('search') ?? '';
  const relationType = searchParams.get('type') ?? '';
  const archive = searchParams.get('archive') ?? 'active';
  const includeDisconnected = searchParams.get('disconnected') !== 'false';
  const [editing, setEditing] = useState<RelationItem | 'new' | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const query = useMemo(() => {
    const params = new URLSearchParams({ includeDisconnected: String(includeDisconnected), archive });
    if (search) params.set('search', search);
    if (relationType) params.set('type', relationType);
    return params.toString();
  }, [archive, includeDisconnected, relationType, search]);
  const resource = useResource<RelationsData>(`/relations/worlds/${worldId}?${query}`);
  const load = async () => { resource.reload(); };
  const elements = useMemo(() => resource.status === 'success' ? graphElements(resource.data, view, selectedNodeId) : { nodes: [], edges: [] }, [resource, selectedNodeId, view]);
  const update = (key: string, value: string) => setSearchParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const data = resource.data;
  const closeEditor = () => setEditing(null);
  const saved = async () => { closeEditor(); await load(); };
  const deleteRelation = async (relation: RelationItem) => {
    if (!confirm(`Arquivar a relação “${relationTitle(relation)}”?`)) return;
    try { await deleteApi(`/relations/${relation.id}`); if (editing !== 'new' && editing?.id === relation.id) closeEditor(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível arquivar a relação.'); }
  };
  const restoreRelation = async (relation: RelationItem) => {
    try { await postJson(`/relations/${relation.id}/restore`, {}); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível restaurar a relação.'); }
  };
  return <div className="page relations-page">
    <PageHeader eyebrow="Relações do World" title={data.world.name} description="Grafo de verdade e conhecimento do jogador derivados das mesmas permissões do Vault." action={data.world.isOwner && data.nodes.length >= 2 ? <button className="primary-button" onClick={() => setEditing('new')}><Plus size={17}/>Nova relação</button> : undefined}/>
    <nav className="relation-view-tabs" aria-label="Visualização das relações"><button className={view === 'graph' ? 'active' : ''} onClick={() => update('view', 'graph')}><GitFork size={16}/>Grafo</button><button className={view === 'list' ? 'active' : ''} onClick={() => update('view', 'list')}><List size={16}/>Lista</button><button className={view === 'genealogy' ? 'active' : ''} onClick={() => update('view', 'genealogy')}><UsersRound size={16}/>Genealogia</button></nav>
    <section className="panel relation-filters"><label className="search-box"><Search/><input aria-label="Buscar relações" value={search} onChange={(event) => update('search', event.target.value)} placeholder="Entidade ou rótulo"/></label><label>Tipo<select aria-label="Tipo de relação" value={relationType} onChange={(event) => update('type', event.target.value)}><option value="">Todos os tipos</option>{RELATION_TYPES.map((type) => <option key={type} value={type}>{displayLabel(type)}</option>)}</select></label>{data.world.isOwner && <label>Arquivo<select aria-label="Arquivo de relações" value={archive} onChange={(event) => update('archive', event.target.value)}><option value="active">Ativas</option><option value="archived">Arquivadas</option><option value="all">Todas</option></select></label>}<label className="check-row"><input type="checkbox" checked={includeDisconnected} onChange={(event) => update('disconnected', String(event.target.checked))}/>Exibir entidades desconectadas</label></section>
    {error && <p className="form-error">{error}</p>}
    {editing && (
      <RelationEditor key={editing === 'new' ? 'new' : editing.id} worldId={worldId} nodes={data.nodes} relation={editing === 'new' ? null : editing} onSaved={saved} onCancel={closeEditor}/>
    )}
    {data.nodes.length < 2 ? <Empty title="Crie ao menos duas entidades" text="Relações conectam entidades existentes do mesmo World." action="Adicionar entidade" to={`/app/vault/new?worldId=${worldId}`}/> : view === 'list' ? <section className="panel relation-list"><div className="section-heading"><div><h2>Relações registradas</h2><p className="section-note">{data.relations.length} relações autorizadas.</p></div></div>{data.relations.length ? <ul className="clean-list">{data.relations.map((relation) => <li key={relation.id}><span><strong>{relation.source.name} {relation.direction === 'DIRECTED' ? '→' : '↔'} {relation.target.name}</strong><small>{relationTitle(relation)} · {displayLabel(relation.visibility)}{relation.strength ? ` · força ${relation.strength}` : ''}{relation.archivedAt ? ' · arquivada' : ''}</small></span><div className="button-row"><Link className="ghost-button link-button" to={`/app/vault/${relation.source.id}`}>Origem</Link>{data.world.isOwner && (relation.archivedAt ? <button className="secondary-button" onClick={() => void restoreRelation(relation)}><RotateCcw size={15}/>Restaurar</button> : <><button className="secondary-button" onClick={() => setEditing(relation)}>Editar</button><button className="danger-button" aria-label={`Arquivar relação ${relationTitle(relation)}`} onClick={() => void deleteRelation(relation)}><Trash2 size={15}/></button></>)}</div></li>)}</ul> : <p>Nenhuma relação corresponde aos filtros.</p>}</section> : <section className="relation-graph panel"><div className="graph-help"><span>Clique em um nó para destacar a vizinhança.</span>{selectedNodeId && <button className="ghost-button" onClick={() => setSelectedNodeId(null)}><RotateCcw size={15}/>Limpar destaque</button>}</div>{view === 'genealogy' && elements.edges.length === 0 ? <Empty title="Nenhuma relação genealógica" text="Use Pai, Filho, Irmão ou Parceiro para formar a árvore." action="Criar relação" to={`/app/worlds/${worldId}/relations?view=list`}/> : <ReactFlow nodes={elements.nodes} edges={elements.edges} onNodeClick={(_, node) => setSelectedNodeId(node.id)} onNodeDoubleClick={(_, node) => location.assign(`/app/vault/${node.id}`)} onEdgeClick={(_, edge) => { const relation = data.relations.find((item) => item.id === edge.id); if (relation && data.world.isOwner && !relation.archivedAt) setEditing(relation); }} fitView minZoom={0.2} maxZoom={1.8} nodesConnectable={false} nodesDraggable={false} deleteKeyCode={null}><Background/><MiniMap pannable zoomable/><Controls showInteractive={false}/></ReactFlow>}</section>}
  </div>;
}
