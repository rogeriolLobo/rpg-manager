import { Archive, BookOpen, CalendarDays, Castle, Gauge, GitFork, Globe2, LogOut, Menu, NotebookPen, Settings, Shield, UsersRound, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useActiveWorld } from '../world/active-world-context';
import { CommandPalette } from './command-palette';

export function AppShell() {
  const [open, setOpen] = useState(false); const { user, logout } = useAuth(); const navigate = useNavigate();
  const { worlds, activeWorld, loading, setActiveWorldId } = useActiveWorld();
  const contextualLinks = activeWorld ? [
    [`/app/worlds/${activeWorld.id}`, Gauge, 'Dashboard'],
    [`/app/vault?worldId=${activeWorld.id}`, Archive, 'Vault'],
    [`/app/worlds/${activeWorld.id}/wiki`, BookOpen, 'Wiki'],
    [`/app/worlds/${activeWorld.id}/relations`, GitFork, 'Relações'],
    [`/app/worlds/${activeWorld.id}/timeline`, CalendarDays, 'Timeline'],
    ...(activeWorld.isOwner ? [[`/app/worlds/${activeWorld.id}/journal`, NotebookPen, 'Diário'] as const] : []),
    [`/app/worlds/${activeWorld.id}/portal`, UserRound, 'Portal do jogador'],
    [`/app/campaigns?worldId=${activeWorld.id}`, Castle, 'Campanhas'],
  ] as const : [['/app', Gauge, 'Visão geral']] as const;
  const globalLinks = [
    ['/app/library', BookOpen, 'Biblioteca'], ['/app/groups', UsersRound, 'Grupos'], ['/app/worlds', Globe2, 'Mundos'],
  ] as const;
  const accountLinks = [
    ['/app/settings', Settings, 'Configurações'], ['/app/security', Shield, 'Segurança'], ['/app/profile', UserRound, 'Perfil'],
  ] as const;
  const changeWorld = async (worldId: string) => {
    const selected = worldId || null; await setActiveWorldId(selected); if (selected) navigate(`/app/worlds/${selected}`);
  };
  const nav = (links: readonly (readonly [string, typeof Gauge, string])[]) => links.map(([to, Icon, label]) => <NavLink key={`${to}-${label}`} to={to} end={label === 'Dashboard' || to === '/app'} onClick={() => setOpen(false)}><Icon size={19}/>{label}</NavLink>);
  return <div className="app-shell"><header className="mobile-header"><button className="icon-button" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}>{open ? <X/> : <Menu/>}</button><span className="brand-mark">RPG Manager</span></header>
    <aside className={`sidebar ${open ? 'open' : ''}`}><div><div className="brand"><span className="brand-rune" aria-hidden="true">R</span><div><strong>RPG Manager</strong><small>Huginn &amp; Muninn</small></div></div>
      <label className="world-selector"><span>Contexto ativo</span><select aria-label="Selecionar contexto ativo" disabled={loading} value={activeWorld?.id ?? ''} onChange={(event) => void changeWorld(event.target.value)}><option value="">Nenhum World</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
      <CommandPalette onNavigate={() => setOpen(false)}/>
      <nav aria-label="Navegação contextual">{nav(contextualLinks)}</nav>
      <nav className="secondary-nav" aria-label="Navegação geral">{nav(globalLinks)}</nav>
      <nav className="secondary-nav" aria-label="Conta">{nav(accountLinks)}</nav></div>
      <div className="sidebar-footer"><span>{user?.displayName}</span><small>{user?.email}</small><button className="ghost-button" onClick={() => void logout()}><LogOut size={17}/>Sair</button></div></aside>
    <main className="main-content"><Outlet/></main></div>;
}
