import { Plus, Save, Shield, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { Empty, PageHeader } from './dashboard-page';
import { RegisteredUserSearch, type DirectoryUser } from '../components/registered-user-search';
import { displayLabel } from '../labels';

interface PlayGroup {
  id: string;
  name: string;
  notes: string;
  memberCount?: number;
  rpgCount?: number;
  campaignCount?: number;
  gameMasterName?: string | null;
}

interface PlayGroupMember {
  id: string;
  playerName: string;
  notes: string;
  active: number;
  linkedUserId: string | null;
  isGameMaster: number;
}
interface GroupCampaign { id:string; name:string; status:string; rpgTitle:string }

export function GroupsPage() {
  const resource = useResource<{items:PlayGroup[]}>('/groups');
  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const items = resource.data.items;
  return <div className="page"><PageHeader eyebrow="Grupos" title="Grupos de jogo" description="Reúna jogadores uma vez e reutilize o grupo em RPGs e campanhas." action={<Link className="primary-button link-button" to="/app/groups/new"><Plus size={18}/>Novo grupo</Link>}/>
    {items.length===0?<Empty title="Nenhum grupo cadastrado" text="Crie um grupo para organizar os jogadores das próximas mesas." action="Criar grupo" to="/app/groups/new"/>:<div className="campaign-grid">{items.map((item)=><Link className="campaign-card" to={`/app/groups/${item.id}`} key={item.id}><span className="eyebrow">{item.memberCount??0} jogadores</span><h2>{item.name}</h2><p>{item.notes||'Sem observações.'}</p><dl><div><dt>Narrador</dt><dd>{item.gameMasterName||'Não definido'}</dd></div><div><dt>Campanhas</dt><dd>{item.campaignCount??0}</dd></div></dl></Link>)}</div>}
  </div>;
}

export function GroupFormPage() {
  const {id}=useParams(); const navigate=useNavigate(); const [form,setForm]=useState({name:'',notes:''}); const [error,setError]=useState('');
  // RPG-1.0-BATCH7: guard `active` evita que a resposta descartável do efeito duplicado pelo
  // React StrictMode (dev only) sobrescreva `form` depois que o usuário já começou a editar
  // (mesmo achado real de VaultFormPage/WorldFormPage, via E2E).
  useEffect(()=>{let active=true;if(id)void api<{item:PlayGroup}>(`/groups/${id}`).then(({item})=>{if(active)setForm({name:item.name,notes:item.notes});}).catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Não foi possível carregar este grupo.');});return()=>{active=false;};},[id]);
  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');try{const result=id?await patchJson<{item:PlayGroup}>(`/groups/${id}`,form):await postJson<{item:PlayGroup}>('/groups',form);navigate(`/app/groups/${result.item.id}`);}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="page narrow"><PageHeader eyebrow={id?'Editar grupo':'Novo grupo'} title="Organize sua mesa" description="Os membros poderão ser reutilizados em vários RPGs e campanhas."/><form className="panel form-grid" onSubmit={submit}><label className="span-2">Nome do grupo<input value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})} maxLength={120} required/></label><label className="span-2">Observações<textarea value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})} maxLength={5000} rows={5}/></label>{error&&<p className="form-error span-2">{error}</p>}<div className="form-actions span-2"><button type="button" className="ghost-button" onClick={()=>navigate(-1)}>Cancelar</button><button className="primary-button">Salvar grupo</button></div></form></div>;
}

export function GroupDetailPage() {
  const {id}=useParams(); const navigate=useNavigate(); const [error,setError]=useState('');
  const resource=useResource<{item:PlayGroup;members:PlayGroupMember[];campaigns:GroupCampaign[]}>(id?`/groups/${id}`:null);
  const load=async()=>{resource.reload();};
  if(resource.status!=='success')return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const data=resource.data;
  const add=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();setError('');const element=event.currentTarget;const form=new FormData(element);try{await postJson(`/groups/${id}/members`,{playerName:form.get('playerName'),userId:null,notes:form.get('notes'),active:true,isGameMaster:form.get('isGameMaster')==='on'});element.reset();await load();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  const addRegisteredUser=async(user:DirectoryUser,isGameMaster:boolean)=>{setError('');try{await postJson(`/groups/${id}/members`,{playerName:user.displayName,userId:user.id,notes:'',active:true,isGameMaster});await load();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="page"><PageHeader eyebrow="Grupo de jogo" title={data.item.name} description={data.item.notes||'Sem observações.'} action={<Link className="secondary-button link-button" to={`/app/groups/${id}/edit`}>Editar grupo</Link>}/><section className="panel narrator-summary"><Shield/><div><small>Narrador principal</small><strong>{data.item.gameMasterName||'Ainda não definido'}</strong></div></section><section className="panel group-campaigns"><div className="section-heading"><div><h2>Campanhas do grupo</h2><p className="section-note">Mesas que reutilizam esta formação de jogadores.</p></div><Link to={`/app/campaigns/new?playGroupId=${id}`}>Nova campanha</Link></div>{data.campaigns.length?<ul className="clean-list">{data.campaigns.map((campaign)=><li key={campaign.id}><span><Link to={`/app/campaigns/${campaign.id}`}>{campaign.name}</Link><small>{campaign.rpgTitle}</small></span><span className="badge">{displayLabel(campaign.status)}</span></li>)}</ul>:<p>Nenhuma campanha usa este grupo.</p>}</section><section className="panel"><h2>Adicionar conta cadastrada</h2><p className="section-note">Busque pelo nome público ou pelo e-mail completo que a pessoa informou. O e-mail nunca aparece nos resultados.</p><RegisteredUserSearch onAdd={addRegisteredUser}/>{error&&<p className="form-error">{error}</p>}</section><section className="panel"><h2>Adicionar convidado por nome</h2><form className="form-grid" onSubmit={add}><label>Nome do jogador<input name="playerName" required maxLength={100}/></label><label>Observações<input name="notes" maxLength={2000}/></label><label className="checkbox span-2"><input type="checkbox" name="isGameMaster"/>Definir como narrador principal</label><div className="form-actions span-2"><button className="secondary-button"><UserPlus size={17}/>Adicionar convidado</button></div></form></section><section className="panel"><h2>Jogadores</h2>{data.members.length?<div className="group-members">{data.members.map((member)=><GroupMemberEditor key={member.id} groupId={id!} member={member} onUpdated={load}/>)}</div>:<p>Nenhum jogador cadastrado.</p>}</section><button className="danger-button" onClick={async()=>{if(confirm(`Excluir o grupo “${data.item.name}”? Os RPGs e campanhas serão preservados sem o vínculo.`)){await deleteApi(`/groups/${id}`);navigate('/app/groups');}}}><Trash2 size={17}/>Excluir grupo</button></div>;
}

function GroupMemberEditor({groupId,member,onUpdated}:{groupId:string;member:PlayGroupMember;onUpdated:()=>Promise<void>}) {
  const [form,setForm]=useState({playerName:member.playerName,notes:member.notes,active:Boolean(member.active),isGameMaster:Boolean(member.isGameMaster)}); const [error,setError]=useState('');
  const save=async()=>{setError('');try{await patchJson(`/groups/${groupId}/members/${member.id}`,form);await onUpdated();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="member-editor"><label>Jogador{member.linkedUserId&&<small>Conta cadastrada</small>}<input aria-label={`Nome de ${member.playerName}`} value={form.playerName} disabled={Boolean(member.linkedUserId)} onChange={(event)=>setForm({...form,playerName:event.target.value})}/></label><label>Observações<input aria-label={`Observações de ${member.playerName}`} value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})}/></label><label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event)=>setForm({...form,active:event.target.checked})}/>Ativo</label><label className="checkbox narrator-check"><input type="checkbox" checked={form.isGameMaster} onChange={(event)=>setForm({...form,isGameMaster:event.target.checked})}/>Narrador</label><button type="button" className="icon-button" aria-label={`Salvar ${member.playerName}`} onClick={()=>void save()}><Save/></button><button type="button" className="icon-button" aria-label={`Excluir ${member.playerName}`} onClick={async()=>{if(confirm('Excluir este jogador do grupo?')){await deleteApi(`/groups/${groupId}/members/${member.id}`);await onUpdated();}}}><Trash2/></button>{error&&<p className="form-error">{error}</p>}</div>;
}
