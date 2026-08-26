import { BookOpen, Copy, FolderPlus, KeyRound, Plus, Search, Tags, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { useAuth } from '../auth/auth-context';
import { ENTITY_TYPES } from '../../domain/content/types';
import { displayLabel } from '../labels';
import { Empty, Loading, PageHeader } from './dashboard-page';

interface Folder { id: string; parentFolderId: string | null; name: string }
interface Tag { id: string; name: string }
interface WikiItem { id: string; entityType: string; name: string; summary: string; visibility: string; folderId: string | null; folderName: string | null; updatedAt: string }
interface EntityTag extends Tag { entityId: string }
interface Alias { id: string; entityId: string; alias: string }
interface WikiData {
  world: { id: string; name: string; isOwner: boolean };
  items: WikiItem[]; folders: Folder[]; tags: Tag[]; entityTags: EntityTag[]; aliases: Alias[];
  pagination: { page: number; pageSize: number; total: number };
}

function OrganizationEditor({ item, data, onSaved }: { item: WikiItem; data: WikiData; onSaved: () => Promise<void> }) {
  const currentTags = data.entityTags.filter((tag) => tag.entityId === item.id).map((tag) => tag.id);
  const [folderId, setFolderId] = useState(item.folderId ?? '');
  const [tagIds, setTagIds] = useState(currentTags);
  const [aliases, setAliases] = useState(data.aliases.filter((alias) => alias.entityId === item.id).map((alias) => alias.alias).join(', '));
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await patchJson(`/knowledge/${data.world.id}/entities/${item.id}`, { folderId: folderId || null, tagIds, aliases: aliases.split(',').map((alias) => alias.trim()).filter(Boolean) }); await onSaved(); } finally { setSaving(false); } };
  return <details className="wiki-organizer"><summary>Organizar</summary><div className="wiki-organizer-fields"><label>Pasta<select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">Sem pasta</option>{data.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><fieldset><legend>Tags</legend>{data.tags.length ? data.tags.map((tag) => <label className="check-row" key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={(event) => setTagIds((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))}/>{tag.name}</label>) : <small>Crie tags na navegação editorial.</small>}</fieldset><label>Aliases<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="Separados por vírgula"/></label><button className="secondary-button" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Salvar organização'}</button></div></details>;
}

export function WorldWikiPage({ portal = false }: { portal?: boolean }) {
  const { id } = useParams(); const [searchParams, setSearchParams] = useSearchParams(); const [error, setError] = useState('');
  const [folderName, setFolderName] = useState(''); const [tagName, setTagName] = useState('');
  const query = searchParams.toString();
  const resource = useResource<WikiData>(id ? `/knowledge/${id}?${query}` : null);
  const load = async () => { resource.reload(); };
  const update = (key: string, value: string) => setSearchParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); next.delete('page'); return next; });
  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const data = resource.data;
  const pageCount = Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize));
  const createFolder = async (event: FormEvent) => { event.preventDefault(); setError(''); try { await postJson(`/knowledge/${id}/folders`, { name: folderName, parentFolderId: null }); setFolderName(''); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a pasta.'); } };
  const createTag = async (event: FormEvent) => { event.preventDefault(); setError(''); try { await postJson(`/knowledge/${id}/tags`, { name: tagName }); setTagName(''); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a tag.'); } };
  return <div className="page"><PageHeader eyebrow={portal ? 'Portal do jogador' : 'Wiki do World'} title={data.world.name} description={portal ? 'Conteúdo compartilhado com você pelas permissões do narrador.' : 'Conhecimento editorial organizado sem duplicar as entidades do Vault.'} action={!portal && data.world.isOwner ? <Link className="primary-button link-button" to={`/app/vault/new?worldId=${id}`}><Plus size={17}/>Nova entidade</Link> : undefined}/>
    <div className="wiki-layout"><aside className="panel wiki-navigation"><h2><BookOpen size={18}/>Navegação</h2><button className={!searchParams.get('folderId') ? 'active' : ''} onClick={() => update('folderId', '')}>Todo o World</button><button className={searchParams.get('folderId') === 'unfiled' ? 'active' : ''} onClick={() => update('folderId', 'unfiled')}>Sem pasta</button>{data.folders.map((folder) => <div className="editorial-row" key={folder.id}><button className={searchParams.get('folderId') === folder.id ? 'active' : ''} onClick={() => update('folderId', folder.id)}>{folder.name}</button>{!portal && data.world.isOwner && <button className="icon-button" aria-label={`Excluir pasta ${folder.name}`} onClick={async () => { try { await deleteApi(`/knowledge/${id}/folders/${folder.id}`); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir.'); } }}><Trash2 size={14}/></button>}</div>)}
      {!portal && data.world.isOwner && <form className="compact-form" onSubmit={createFolder}><label><FolderPlus size={16}/>Nova pasta<input required maxLength={120} value={folderName} onChange={(event) => setFolderName(event.target.value)}/></label><button className="secondary-button">Criar</button></form>}
      <h3><Tags size={17}/>Tags</h3>{data.tags.map((tag) => <div className="editorial-row" key={tag.id}><button className={searchParams.get('tagId') === tag.id ? 'active' : ''} onClick={() => update('tagId', searchParams.get('tagId') === tag.id ? '' : tag.id)}>#{tag.name}</button>{!portal && data.world.isOwner && <button className="icon-button" aria-label={`Excluir tag ${tag.name}`} onClick={async () => { await deleteApi(`/knowledge/${id}/tags/${tag.id}`); await load(); }}><Trash2 size={14}/></button>}</div>)}{!portal && data.world.isOwner && <form className="compact-form" onSubmit={createTag}><label>Nova tag<input required maxLength={60} value={tagName} onChange={(event) => setTagName(event.target.value)}/></label><button className="secondary-button">Criar</button></form>}</aside>
      <section><div className="wiki-filters panel"><label className="search-box"><Search/><input aria-label="Buscar na Wiki" value={searchParams.get('search') ?? ''} onChange={(event) => update('search', event.target.value)} placeholder="Nome, resumo ou alias"/></label><select aria-label="Tipo de entidade" value={searchParams.get('type') ?? ''} onChange={(event) => update('type', event.target.value)}><option value="">Todos os tipos</option>{ENTITY_TYPES.map((type) => <option key={type} value={type}>{displayLabel(type)}</option>)}</select></div>{error && <p className="form-error">{error}</p>}{data.items.length ? <div className="wiki-grid">{data.items.map((item) => { const tags = data.entityTags.filter((tag) => tag.entityId === item.id); const aliases = data.aliases.filter((alias) => alias.entityId === item.id); return <article className="entity-card" key={item.id}><div className="entity-card-heading"><span className="entity-type">{displayLabel(item.entityType)}</span><span>{displayLabel(item.visibility)}</span></div><h2><Link to={`/app/vault/${item.id}`}>{item.name}</Link></h2><p>{item.summary || 'Sem resumo.'}</p>{aliases.length > 0 && <small>Também: {aliases.map((alias) => alias.alias).join(', ')}</small>}<div className="tag-list">{tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}</div><div className="entity-meta"><span>{item.folderName || 'Sem pasta'}</span><span>{new Date(item.updatedAt).toLocaleDateString('pt-BR')}</span></div>{!portal && data.world.isOwner && <OrganizationEditor item={item} data={data} onSaved={load}/>}</article>; })}</div> : <Empty title="Nenhum conhecimento encontrado" text="A Wiki apresenta as entidades autorizadas deste World. Ajuste os filtros ou crie a primeira entidade." action={data.world.isOwner && !portal ? 'Criar entidade' : 'Abrir World'} to={data.world.isOwner && !portal ? `/app/vault/new?worldId=${id}` : `/app/worlds/${id}`}/>} {data.pagination.total > data.pagination.pageSize && <nav className="pagination"><button className="secondary-button" disabled={data.pagination.page <= 1} onClick={() => update('page', String(data.pagination.page - 1))}>Anterior</button><span>Página {data.pagination.page} de {pageCount}</span><button className="secondary-button" disabled={data.pagination.page >= pageCount} onClick={() => update('page', String(data.pagination.page + 1))}>Próxima</button></nav>}</section></div></div>;
}



interface Invite { id: string; codeHint: string; expiresAt: string; maxUses: number; useCount: number; revokedAt: string | null }
export function WorldInvitesPanel({ worldId }: { worldId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]); const [link, setLink] = useState(''); const [error, setError] = useState('');
  const load = async () => setInvites((await api<{ items: Invite[] }>(`/world-invites/${worldId}`)).items);
  useEffect(() => { void api<{ items: Invite[] }>(`/world-invites/${worldId}`).then((result) => setInvites(result.items)).catch(() => setInvites([])); }, [worldId]);
  const create = async () => { setError(''); try { const result = await postJson<{ item: { code: string } }>(`/world-invites/${worldId}`, { expiresInDays: 7, maxUses: 1 }); setLink(`${location.origin}/invite/${result.item.code}`); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o convite.'); } };
  return <section className="panel world-invites"><div className="section-heading"><div><h2><KeyRound size={19}/>Convites por link</h2><p className="section-note">O link expira em 7 dias e pode ser usado uma vez. O World precisa estar visível para membros convidados.</p></div><button className="secondary-button" onClick={() => void create()}><Plus size={16}/>Criar convite</button></div>{link && <div className="invite-link"><input readOnly value={link}/><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(link)}><Copy size={16}/>Copiar</button></div>}{error && <p className="form-error">{error}</p>}<ul className="clean-list">{invites.map((invite) => <li key={invite.id}><span><strong>Código …{invite.codeHint}</strong><small>{invite.useCount}/{invite.maxUses} usos · expira {new Date(invite.expiresAt).toLocaleDateString('pt-BR')}{invite.revokedAt ? ' · revogado' : ''}</small></span>{!invite.revokedAt && <button className="ghost-button" onClick={async () => { await deleteApi(`/world-invites/${worldId}/${invite.id}`); await load(); }}>Revogar</button>}</li>)}</ul></section>;
}

export function InviteAcceptPage() {
  const { token } = useParams(); const { user, loading } = useAuth(); const navigate = useNavigate(); const [error, setError] = useState(''); const [accepting, setAccepting] = useState(false);
  const accept = async () => { setAccepting(true); setError(''); try { const result = await postJson<{ world: { id: string } }>(`/world-invites/accept/${token}`, {}); navigate(`/app/worlds/${result.world.id}/portal`); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível aceitar o convite.'); } finally { setAccepting(false); } };
  if (loading) return <Loading/>;
  return <main className="invite-page"><section className="auth-card"><span className="eyebrow">Convite de World</span><h1>Entre para explorar este mundo</h1>{user ? <><p>Você aceitará o convite como <strong>{user.displayName}</strong>, com acesso de leitura definido pelo narrador.</p><button className="primary-button" disabled={accepting} onClick={() => void accept()}>{accepting ? 'Aceitando…' : 'Aceitar convite'}</button></> : <><p>Entre ou crie sua conta antes de aceitar o convite.</p><div className="button-row"><Link className="primary-button link-button" to={`/login?returnTo=/invite/${token}`}>Entrar</Link><Link className="secondary-button link-button" to={`/register?returnTo=/invite/${token}`}>Criar conta</Link></div></>}{error && <p className="form-error">{error}</p>}</section></main>;
}
