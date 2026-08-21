import { Search, Shield } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { api } from '../api/client';

export interface DirectoryUser { id: string; displayName: string }

export function RegisteredUserSearch({onAdd,allowGameMaster=true,addLabel='Adicionar jogador'}:{
  onAdd:(user:DirectoryUser,isGameMaster:boolean)=>Promise<void>;
  allowGameMaster?:boolean;
  addLabel?:string;
}) {
  const [query,setQuery]=useState('');
  const [items,setItems]=useState<DirectoryUser[]>([]);
  const [searched,setSearched]=useState(false);
  const [error,setError]=useState('');
  const search=async()=>{if(query.trim().length<3){setError('Digite pelo menos 3 caracteres.');return;}setError('');try{const result=await api<{items:DirectoryUser[]}>(`/directory/users?q=${encodeURIComponent(query)}`);setItems(result.items);setSearched(true);}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível buscar as contas.');}};
  const submitOnEnter=(event:KeyboardEvent<HTMLInputElement>)=>{if(event.key==='Enter'){event.preventDefault();void search();}};
  return <div className="directory-search"><div className="inline-form" role="search"><label>Nome público ou e-mail exato<input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={submitOnEnter} minLength={3} maxLength={254} placeholder="Nome ou e-mail completo"/></label><button type="button" className="secondary-button" disabled={query.trim().length<3} onClick={()=>void search()}><Search size={17}/>Buscar</button></div>{error&&<p className="form-error">{error}</p>}{searched&&(items.length?<ul className="directory-results">{items.map((user)=><li key={user.id}><strong>{user.displayName}</strong><div className="button-row"><button type="button" className="ghost-button" onClick={()=>void onAdd(user,false)}>{addLabel}</button>{allowGameMaster&&<button type="button" className="secondary-button" onClick={()=>void onAdd(user,true)}><Shield size={16}/>Adicionar como narrador</button>}</div></li>)}</ul>:<p>Nenhuma conta encontrada.</p>)}</div>;
}
