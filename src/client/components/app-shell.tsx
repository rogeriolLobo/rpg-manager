import { Archive, BookOpen, CalendarDays, Castle, Dices, Gauge, GitFork, Globe2, Link2, LogOut, Map, Menu, NotebookPen, PawPrint, Settings, Shield, Swords, UsersRound, UserRound, Users, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useActiveWorld } from '../world/active-world-context';
import { CommandPalette } from './command-palette';
import { NotificationsButton } from '../pages/social-pages';

export function AppShell() {
  const [open, setOpen] = useState(false); const { user, logout } = useAuth(); const navigate = useNavigate();
  const { worlds, activeWorld, loading, setActiveWorldId } = useActiveWorld();
  const globalLinks = [
    ['/app/library', BookOpen, 'Biblioteca'],
    ['/app/vault', Archive, 'Vault'],
    ['/app/groups', UsersRound, 'Grupos'],
    ['/app/friends', Users, 'Amigos'],
    ['/app/campaigns', Castle, 'Campanhas'],
    // F-033 (Player View integrada): descoberta de campanhas onde o usuário é jogador, sem
    // depender de link enviado pelo GM — link global sempre visível (CLAUDE.md §3).
    ['/app/my-tables', Swords, 'Minhas Mesas'],
    ['/app/worlds', Globe2, 'Mundos'],
  ] as const;
  const worldLinks = activeWorld ? [
    [`/app/worlds/${activeWorld.id}`, Gauge, 'Visão do World'],
    [`/app/worlds/${activeWorld.id}/wiki`, BookOpen, 'Wiki'],
    ...(activeWorld.isOwner ? [[`/app/worlds/${activeWorld.id}/journal`, NotebookPen, 'Diário'] as const] : []),
    [`/app/worlds/${activeWorld.id}/resources`, Link2, 'Recursos externos'],
    [`/app/worlds/${activeWorld.id}/cartography`, Map, 'Cartografia'],
    [`/app/worlds/${activeWorld.id}/relations`, GitFork, 'Relações'],
    [`/app/worlds/${activeWorld.id}/timeline`, CalendarDays, 'Timeline'],
    [`/app/worlds/${activeWorld.id}/bestiary`, PawPrint, 'Bestiário'],
    [`/app/worlds/${activeWorld.id}/portal`, UserRound, 'Portal do jogador'],
  ] as const : [];
  const accountLinks = [
    ['/app/gm-tools', Dices, 'Ferramentas do Mestre'], ['/app/settings', Settings, 'Configurações'], ['/app/security', Shield, 'Segurança'], ['/app/profile', UserRound, 'Perfil'],
  ] as const;
  const changeWorld = async (worldId: string) => {
    const selected = worldId || null; await setActiveWorldId(selected); if (selected) navigate(`/app/worlds/${selected}`);
  };
  const nav = (links: readonly (readonly [string, typeof Gauge, string])[]) => links.map(([to, Icon, label]) => <NavLink key={`${to}-${label}`} to={to} end={label === 'Visão do World' || to === '/app'} onClick={() => setOpen(false)}><Icon size={19}/>{label}</NavLink>);
  return <div className="app-shell"><header className="mobile-header"><button className="icon-button" onClick={() => setOpen(!open)} aria-label={open ? 'Fechar menu' : 'Abrir menu'}>{open ? <X/> : <Menu/>}</button><span className="brand-mark">RPG Manager</span></header>
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      {/* BATCH19 (2ª correção): o dropdown de notificações vazava para fora da sidebar (18rem
          de largura, sidebar tem só ~220px úteis) e era cortado — a regra do CSS que redefine
          overflow-x para auto quando só overflow-y é setado (achado real via screenshot do
          usuário) fazia .sidebar > div:first-child recortar qualquer coisa que ultrapassasse a
          largura, mesmo um descendente position:absolute. Fix real: separar a área fixa do
          topo (nunca teve motivo pra ter scroll) da área de navegação (essa sim cresce e
          precisa rolar) em dois containers distintos — só a segunda leva overflow-y:auto. */}
      <div className="sidebar-fixed-top">
        <div className="brand"><span className="brand-rune" aria-hidden="true">R</span><div><strong>RPG Manager</strong><small>Huginn &amp; Muninn</small></div><NotificationsButton/></div>
        <label className="world-selector"><span>Contexto ativo</span><select aria-label="Selecionar contexto ativo" disabled={loading} value={activeWorld?.id ?? ''} onChange={(event) => void changeWorld(event.target.value)}><option value="">Nenhum World</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        <div className="sidebar-toolbar"><CommandPalette onNavigate={() => setOpen(false)}/></div>
      </div>
      <div className="sidebar-scroll">
        <nav aria-label="Navegação principal"><NavLink to="/app" end onClick={() => setOpen(false)}><Gauge size={19}/>Visão geral</NavLink></nav>
        <nav className="nav-section" aria-label="Navegação geral"><span className="nav-section-label">Geral</span>{nav(globalLinks)}</nav>
        {worldLinks.length > 0 && <nav className="nav-section" aria-label={`Seção de ${activeWorld!.name}`}><span className="nav-section-label">{activeWorld!.name}</span>{nav(worldLinks)}</nav>}
        <nav className="nav-section" aria-label="Conta"><span className="nav-section-label">Sistema</span>{nav(accountLinks)}</nav>
      </div>
      <div className="sidebar-footer"><span>{user?.displayName}</span><small>{user?.email}</small><button className="ghost-button" onClick={() => void logout()}><LogOut size={17}/>Sair</button></div>
    </aside>
    <main className="main-content"><Outlet/></main></div>;
}

