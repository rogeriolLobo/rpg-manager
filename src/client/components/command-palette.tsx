import { Archive, BookMarked, BookOpen, CalendarDays, Castle, Dices, FileText, GitFork, Globe2, Link2, Map, NotebookPen, PawPrint, ScrollText, Search, Settings, Swords, Users, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { displayLabel } from '../labels';
import { useActiveWorld } from '../world/active-world-context';

interface SearchResult {
  id: string;
  name: string;
  summary: string;
  subtype: string | null;
  kind: 'ENTITY' | 'WORLD' | 'CAMPAIGN' | 'GROUP' | 'RPG' | 'JOURNAL';
  worldId: string | null;
  worldName: string | null;
}

function resultPath(item: SearchResult): string {
  if (item.kind === 'ENTITY') return `/app/vault/${item.id}`;
  if (item.kind === 'WORLD') return `/app/worlds/${item.id}`;
  if (item.kind === 'CAMPAIGN') return `/app/campaigns/${item.id}`;
  if (item.kind === 'GROUP') return `/app/groups/${item.id}`;
  if (item.kind === 'RPG') return `/app/library/${item.id}`;
  return `/app/worlds/${item.worldId}/journal?page=${item.id}`;
}

export function CommandPalette({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate(); const { activeWorld } = useActiveWorld();
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [searchEverywhere, setSearchEverywhere] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); setQuery(''); setResults([]); };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); setOpen((current) => !current); }
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim() }); if (activeWorld && !searchEverywhere) params.set('worldId', activeWorld.id);
      void api<{ items: SearchResult[] }>(`/search?${params}`).then((response) => { if (active) setResults(response.items); }).catch(() => { if (active) setResults([]); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeWorld, query, searchEverywhere]);
  const commands = useMemo(() => [
    { label: 'Abrir Biblioteca', path: '/app/library', Icon: BookOpen },
    { label: 'Abrir Vault', path: '/app/vault', Icon: Archive },
    { label: 'Abrir Compêndio', path: '/app/compendium', Icon: BookMarked },
    { label: 'Abrir Fichas', path: '/app/sheets', Icon: ScrollText },
    { label: 'Abrir Worlds', path: '/app/worlds', Icon: Globe2 },
    { label: 'Abrir Grupos', path: '/app/groups', Icon: UsersRound },
    { label: 'Abrir Amigos', path: '/app/friends', Icon: Users },
    { label: 'Abrir Campanhas', path: '/app/campaigns', Icon: Castle },
    { label: 'Abrir Minhas Mesas', path: '/app/my-tables', Icon: Swords },
    { label: 'Abrir Ferramentas do Mestre', path: '/app/gm-tools', Icon: Dices },
    { label: 'Abrir Configurações', path: '/app/settings', Icon: Settings },
    ...(activeWorld ? [
      { label: `Visão do World · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}`, Icon: Globe2 },
      { label: `Wiki · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/wiki`, Icon: BookOpen },
      ...(activeWorld.isOwner ? [{ label: `Diário · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/journal`, Icon: NotebookPen }] : []),
      { label: `Recursos externos · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/resources`, Icon: Link2 },
      { label: `Cartografia · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/cartography`, Icon: Map },
      { label: `Relações · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/relations`, Icon: GitFork },
      { label: `Timeline · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/timeline`, Icon: CalendarDays },
      { label: `Bestiário · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/bestiary`, Icon: PawPrint },
      { label: `Portal · ${activeWorld.name}`, path: `/app/worlds/${activeWorld.id}/portal`, Icon: FileText },
    ] : []),
  ], [activeWorld]);
  const go = (path: string) => { close(); onNavigate?.(); navigate(path); };
  if (!open) return <button className="command-trigger" aria-label="Abrir paleta de comandos" onClick={() => setOpen(true)}><Search size={16}/>Comandos <kbd>Ctrl K</kbd></button>;
  return <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Busca global e comandos">
      <label className="command-search"><Search/><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim().length < 2) setResults([]); }} placeholder={activeWorld ? `Buscar em ${activeWorld.name}` : 'Buscar em todo o RPG Manager'}/></label>
      {activeWorld && <button className="command-scope" onClick={() => setSearchEverywhere((current) => !current)}>Escopo: {searchEverywhere ? 'todo o RPG Manager' : activeWorld.name}</button>}
      <div className="command-results">
        {query.trim().length < 2 ? <><small>ATALHOS</small>{commands.map(({ label, path, Icon }) => <button key={path} onClick={() => go(path)}><Icon size={17}/><span>{label}</span></button>)}</>
          : results.length ? <><small>RESULTADOS</small>{results.map((item) => <button key={`${item.kind}-${item.id}`} onClick={() => go(resultPath(item))}><Search size={17}/><span><strong>{item.name}</strong><small>{displayLabel(item.subtype ?? item.kind)}{item.worldName ? ` · ${item.worldName}` : ''}</small></span></button>)}</>
            : <p className="command-empty">Nenhum resultado autorizado encontrado.</p>}
      </div>
    </section>
  </div>;
}
