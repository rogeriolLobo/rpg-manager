import { BookOpen, Castle, Gauge, LogOut, Menu, Settings, Shield, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

const links = [
  ['/app',Gauge,'Visão geral'],['/app/library',BookOpen,'Biblioteca'],['/app/campaigns',Castle,'Campanhas'],
  ['/app/settings',Settings,'Configurações'],['/app/security',Shield,'Segurança'],['/app/profile',UserRound,'Perfil'],
] as const;
export function AppShell() {
  const [open,setOpen]=useState(false); const {user,logout}=useAuth();
  return <div className="app-shell"><header className="mobile-header"><button className="icon-button" onClick={()=>setOpen(!open)} aria-label={open?'Fechar menu':'Abrir menu'}>{open?<X/>:<Menu/>}</button><span className="brand-mark">RPG Manager</span></header>
    <aside className={`sidebar ${open?'open':''}`}><div><div className="brand"><span className="brand-rune">R</span><div><strong>RPG Manager</strong><small>Biblioteca do aventureiro</small></div></div>
      <nav aria-label="Navegação principal">{links.map(([to,Icon,label])=><NavLink key={to} to={to} end={to==='/app'} onClick={()=>setOpen(false)}><Icon size={19}/>{label}</NavLink>)}</nav></div>
      <div className="sidebar-footer"><span>{user?.displayName}</span><small>{user?.email}</small><button className="ghost-button" onClick={()=>void logout()}><LogOut size={17}/>Sair</button></div></aside>
    <main className="main-content"><Outlet/></main></div>;
}
