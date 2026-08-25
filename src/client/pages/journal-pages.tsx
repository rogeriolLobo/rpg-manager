import { type FormEvent, useState } from 'react';
import { FilePlus2, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { RevisionHistoryButton } from '../components/revision-history';
import { PageHeader } from './dashboard-page';

interface Folder { id: string; parentFolderId: string | null; name: string; sortOrder: number }
interface JournalPage { id: string; folderId: string | null; title: string; content: string; createdAt: string; updatedAt: string; worldIds: string[] }
interface JournalData { folders: Folder[]; pages: JournalPage[] }
interface World { id: string; name: string; isOwner: boolean; status: 'ACTIVE' | 'ARCHIVED' }
interface WorldList { items: World[] }

interface JournalEditorProps {
  page: JournalPage;
  folders: Folder[];
  worlds: World[];
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
  setError: (error: string) => void;
}

function JournalEditor({ page, folders, worlds, onSaved, onDeleted, setError }: JournalEditorProps) {
  const [draft, setDraft] = useState({ title: page.title, content: page.content, folderId: page.folderId });
  const [linkedWorldIds, setLinkedWorldIds] = useState(page.worldIds);

  const save = async () => {
    setError('');
    try {
      await patchJson(`/journal/pages/${page.id}`, { title: draft.title, content: draft.content, folderId: draft.folderId || null });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a página.');
    }
  };

  const setWorldLink = async (worldId: string, linked: boolean) => {
    setError('');
    const previousWorldIds = linkedWorldIds;
    setLinkedWorldIds(linked
      ? [...new Set([...linkedWorldIds, worldId])]
      : linkedWorldIds.filter((linkedWorldId) => linkedWorldId !== worldId));
    try {
      const path = `/journal/pages/${page.id}/worlds/${worldId}`;
      if (linked) await postJson<void>(path, {});
      else await deleteApi<void>(path);
      await onSaved();
    } catch (reason) {
      setLinkedWorldIds(previousWorldIds);
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar os vínculos da página.');
    }
  };

  return <>
    <div className="section-heading"><h2>{page.title}</h2><RevisionHistoryButton basePath={`/journal/pages/${page.id}`} canRestore={true} onRestored={onSaved}/></div>
    <label>Título<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label>
    <label>Pasta<select value={draft.folderId || ''} onChange={(event) => setDraft({ ...draft, folderId: event.target.value })}><option value="">Sem pasta</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label>
    <fieldset>
      <legend>Worlds vinculados</legend>
      {worlds.length ? worlds.map((world) => <label className="check-row" key={world.id}><input type="checkbox" checked={linkedWorldIds.includes(world.id)} onChange={(event) => void setWorldLink(world.id, event.target.checked)}/><span>{world.name}</span></label>) : <p className="section-note">Crie um World para usar esta página como contexto nele.</p>}
    </fieldset>
    <label>Conteúdo<textarea rows={24} maxLength={100000} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="Ideias, preparação, segredos e lembretes…"/></label>
    <div className="form-actions"><button className="danger-button" onClick={async () => { if (confirm(`Excluir “${page.title}”?`)) await onDeleted(); }}><Trash2 size={16}/>Excluir</button><button className="primary-button" onClick={() => void save()}>Salvar página</button></div>
  </>;
}

export function JournalPageContainer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const worldId = searchParams.get('worldId');
  const journalResource = useResource<JournalData>(worldId ? `/journal/${worldId}` : '/journal');
  const worldsResource = useResource<WorldList>('/worlds?pageSize=100');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('page'));
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');

  if (journalResource.status === 'error') return <div className="page"><PageHeader eyebrow="Privado" title="Diário" description="Notas que pertencem a você."/><div className="panel"><p className="form-error">{journalResource.error instanceof Error ? journalResource.error.message : 'Não foi possível carregar o Diário.'}</p></div></div>;
  if (worldsResource.status === 'error') return <div className="page"><PageHeader eyebrow="Privado" title="Diário" description="Notas que pertencem a você."/><div className="panel"><p className="form-error">{worldsResource.error instanceof Error ? worldsResource.error.message : 'Não foi possível carregar os Worlds.'}</p></div></div>;
  if (journalResource.status !== 'success' || worldsResource.status !== 'success') return null;

  const data = journalResource.data;
  const worlds = worldsResource.data.items.filter((item) => item.isOwner && item.status === 'ACTIVE');
  const selected = data.pages.find((page) => page.id === selectedId);

  const choose = (pageId: string) => {
    setSelectedId(pageId);
    searchParams.set('page', pageId);
    setSearchParams(searchParams, { replace: true });
    setError('');
  };

  const createPage = async () => {
    setError('');
    try {
      const result = await postJson<{ item: JournalPage }>('/journal/pages', { title: 'Nova página', content: '', folderId: null });
      if (worldId) await postJson<void>(`/journal/pages/${result.item.id}/worlds/${worldId}`, {});
      journalResource.reload();
      choose(result.item.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a página.');
    }
  };

  const createFolder = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await postJson('/journal/folders', { name: folderName, parentFolderId: null });
      setFolderName('');
      journalResource.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar a pasta.');
    }
  };

  return <div className="page">
    <PageHeader eyebrow="Privado" title="Diário" description="Notas que pertencem a você e podem ser vinculadas a nenhum, um ou vários Worlds." action={<button className="primary-button" onClick={() => void createPage()}><FilePlus2 size={17}/>Nova página</button>}/>
    <div className="journal-layout">
      <aside className="panel journal-navigation">
        <h2>Páginas</h2>
        {data.pages.map((page) => <button className={selected?.id === page.id ? 'active' : ''} key={page.id} onClick={() => choose(page.id)}><span>{page.title}</span><small>{data.folders.find((folder) => folder.id === page.folderId)?.name || 'Sem pasta'}</small></button>)}
        <h3>Pastas</h3>
        {data.folders.map((folder) => <div className="editorial-row" key={folder.id}><span>{folder.name}</span><button className="icon-button" aria-label={`Excluir pasta ${folder.name}`} onClick={async () => { try { await deleteApi(`/journal/folders/${folder.id}`); journalResource.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir.'); } }}><Trash2 size={14}/></button></div>)}
        <form className="compact-form" onSubmit={(event) => void createFolder(event)}><label>Nova pasta<input required value={folderName} onChange={(event) => setFolderName(event.target.value)}/></label><button className="secondary-button">Criar</button></form>
      </aside>
      <section className="panel journal-editor">
        {selected ? <JournalEditor key={`${selected.id}-${selected.updatedAt}`} page={selected} folders={data.folders} worlds={worlds} setError={setError} onSaved={async () => journalResource.reload()} onDeleted={async () => { await deleteApi(`/journal/pages/${selected.id}`); searchParams.delete('page'); setSearchParams(searchParams, { replace: true }); setSelectedId(null); journalResource.reload(); }}/> : <div><h2>Diário vazio</h2><p>Crie uma página para registrar seus lembretes e notas.</p><button className="primary-button" onClick={() => void createPage()}>Criar primeira página</button></div>}
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  </div>;
}
