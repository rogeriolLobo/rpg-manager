import { Search, Shield } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
  const search=async(event:FormEvent)=>{event.preventDefault();setError('');try{const result=await api<{items:DirectoryUser[]}>(`/directory/users?q=${encodeURIComponent(query)}`);setItems(result.items);setSearched(true);}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível buscar as contas.');}};
  return <div className="directory-search"><form className="inline-form" onSubmit={search}><label>Nome público ou e-mail exato<input value={query} onChange={(event)=>setQuery(event.target.value)} minLength={3} maxLength={254} placeholder="Nome ou e-mail completo" required/></label><button className="secondary-button"><Search size={17}/>Buscar</button></form>{error&&<p className="form-error">{error}</p>}{searched&&(items.length?<ul className="directory-results">{items.map((user)=><li key={user.id}><strong>{user.displayName}</strong><div className="button-row"><button type="button" className="ghost-button" onClick={()=>void onAdd(user,false)}>{addLabel}</button>{allowGameMaster&&<button type="button" className="secondary-button" onClick={()=>void onAdd(user,true)}><Shield size={16}/>Adicionar como narrador</button>}</div></li>)}</ul>:<p>Nenhuma conta encontrada.</p>)}</div>;
}
