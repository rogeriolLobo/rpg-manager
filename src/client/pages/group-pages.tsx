import { Plus, Save, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { Empty, Loading, PageHeader } from './dashboard-page';

interface PlayGroup {
  id: string;
  name: string;
  notes: string;
  memberCount?: number;
  rpgCount?: number;
  campaignCount?: number;
}

interface PlayGroupMember {
  id: string;
  playerName: string;
  notes: string;
  active: number;
}

export function GroupsPage() {
  const [items, setItems] = useState<PlayGroup[]>();
  useEffect(() => { void api<{items:PlayGroup[]}>('/groups').then((result) => setItems(result.items)); }, []);
  return <div className="page"><PageHeader eyebrow="Grupos" title="Grupos de jogo" description="Reúna jogadores uma vez e reutilize o grupo em RPGs e campanhas." action={<Link className="primary-button link-button" to="/app/groups/new"><Plus size={18}/>Novo grupo</Link>}/>
    {!items?<Loading/>:items.length===0?<Empty title="Nenhum grupo cadastrado" text="Crie um grupo para organizar os jogadores das próximas mesas." action="Criar grupo" to="/app/groups/new"/>:<div className="campaign-grid">{items.map((item)=><Link className="campaign-card" to={`/app/groups/${item.id}`} key={item.id}><span className="eyebrow">{item.memberCount??0} jogadores</span><h2>{item.name}</h2><p>{item.notes||'Sem observações.'}</p><dl><div><dt>RPGs</dt><dd>{item.rpgCount??0}</dd></div><div><dt>Campanhas</dt><dd>{item.campaignCount??0}</dd></div></dl></Link>)}</div>}
  </div>;
}

export function GroupFormPage() {
  const {id}=useParams(); const navigate=useNavigate(); const [form,setForm]=useState({name:'',notes:''}); const [error,setError]=useState('');
  useEffect(()=>{if(id)void api<{item:PlayGroup}>(`/groups/${id}`).then(({item})=>setForm({name:item.name,notes:item.notes}));},[id]);
  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');try{const result=id?await patchJson<{item:PlayGroup}>(`/groups/${id}`,form):await postJson<{item:PlayGroup}>('/groups',form);navigate(`/app/groups/${result.item.id}`);}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="page narrow"><PageHeader eyebrow={id?'Editar grupo':'Novo grupo'} title="Organize sua mesa" description="Os membros poderão ser reutilizados em vários RPGs e campanhas."/><form className="panel form-grid" onSubmit={submit}><label className="span-2">Nome do grupo<input value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})} maxLength={120} required/></label><label className="span-2">Observações<textarea value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})} maxLength={5000} rows={5}/></label>{error&&<p className="form-error span-2">{error}</p>}<div className="form-actions span-2"><button type="button" className="ghost-button" onClick={()=>navigate(-1)}>Cancelar</button><button className="primary-button">Salvar grupo</button></div></form></div>;
}

export function GroupDetailPage() {
  const {id}=useParams(); const navigate=useNavigate(); const [data,setData]=useState<{item:PlayGroup;members:PlayGroupMember[]}>(); const [error,setError]=useState('');
  const load=()=>api<{item:PlayGroup;members:PlayGroupMember[]}>(`/groups/${id}`).then(setData);
  useEffect(()=>{void api<{item:PlayGroup;members:PlayGroupMember[]}>(`/groups/${id}`).then(setData);},[id]);
  if(!data)return <Loading/>;
  const add=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setError('');const element=event.currentTarget;const form=new FormData(element);try{await postJson(`/groups/${id}/members`,{playerName:form.get('playerName'),notes:form.get('notes'),active:true});element.reset();await load();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="page"><PageHeader eyebrow="Grupo de jogo" title={data.item.name} description={data.item.notes||'Sem observações.'} action={<Link className="secondary-button link-button" to={`/app/groups/${id}/edit`}>Editar grupo</Link>}/><section className="panel"><h2>Jogadores</h2><form className="form-grid" onSubmit={add}><label>Nome do jogador<input name="playerName" required maxLength={100}/></label><label>Observações<input name="notes" maxLength={2000}/></label><div className="form-actions span-2"><button className="secondary-button"><UserPlus size={17}/>Adicionar jogador</button></div></form>{error&&<p className="form-error">{error}</p>}{data.members.length?<div className="group-members">{data.members.map((member)=><GroupMemberEditor key={member.id} groupId={id!} member={member} onUpdated={load}/>)}</div>:<p>Nenhum jogador cadastrado.</p>}</section><button className="danger-button" onClick={async()=>{if(confirm(`Excluir o grupo “${data.item.name}”? Os RPGs e campanhas serão preservados sem o vínculo.`)){await deleteApi(`/groups/${id}`);navigate('/app/groups');}}}><Trash2 size={17}/>Excluir grupo</button></div>;
}

function GroupMemberEditor({groupId,member,onUpdated}:{groupId:string;member:PlayGroupMember;onUpdated:()=>Promise<void>}) {
  const [form,setForm]=useState({playerName:member.playerName,notes:member.notes,active:Boolean(member.active)}); const [error,setError]=useState('');
  const save=async()=>{setError('');try{await patchJson(`/groups/${groupId}/members/${member.id}`,form);await onUpdated();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="member-editor"><input aria-label={`Nome de ${member.playerName}`} value={form.playerName} onChange={(event)=>setForm({...form,playerName:event.target.value})}/><input aria-label={`Observações de ${member.playerName}`} value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})}/><label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event)=>setForm({...form,active:event.target.checked})}/>Ativo</label><button className="icon-button" aria-label={`Salvar ${member.playerName}`} onClick={()=>void save()}><Save/></button><button className="icon-button" aria-label={`Excluir ${member.playerName}`} onClick={async()=>{if(confirm('Excluir este jogador do grupo?')){await deleteApi(`/groups/${groupId}/members/${member.id}`);await onUpdated();}}}><Trash2/></button>{error&&<p className="form-error">{error}</p>}</div>;
}
