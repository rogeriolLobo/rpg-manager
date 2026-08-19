import { Check, ChevronDown, ChevronUp, FileText, Plus, Swords, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { displayLabel } from '../labels';
import { PageHeader } from './dashboard-page';

// F-025 (BATCH13): Adventures aprofundadas — acts/scenes/encounters/handouts, ligados ao
// Vault Entity ADVENTURE já existente. Ferramenta de preparação do GM: tudo aqui é
// owned-only (mesmo modelo do Diário/Journal) — ver src/server/routes/adventures.ts.

interface SceneEntity { entityId:string; role:string; entityName:string; entityType:string }
interface Encounter { id:string; sceneId:string; name:string; difficulty:string; description:string; gmNotes:string; sortOrder:number }
interface Scene { id:string; act:string; title:string; summary:string; readAloud:string; gmNotes:string; completed:boolean; sortOrder:number; encounters:Encounter[]; entities:SceneEntity[] }
interface Handout { id:string; sceneId:string|null; externalResourceId:string|null; externalResourceTitle:string|null; title:string; content:string; revealed:boolean; sortOrder:number }
interface AdventureStructure { scenes:Scene[]; handouts:Handout[] }
interface EntityOption { id:string; name:string; entityType:string }
interface ExternalResourceOption { id:string; title:string }

const emptyScene = { act:'', title:'', summary:'', readAloud:'', gmNotes:'', completed:false, sortOrder:0 };
const emptyEncounter = { name:'', difficulty:'', description:'', gmNotes:'', sortOrder:0 };
const emptyHandout = { title:'', content:'', sceneId:'', externalResourceId:'', revealed:false, sortOrder:0 };

export function AdventurePrepPage(){
  const {id}=useParams();
  const [adventureName,setAdventureName]=useState('');
  const [adventureWorldId,setAdventureWorldId]=useState<string|null>(null);
  const resource=useResource<AdventureStructure>(id?`/adventures/${id}`:null);
  const [entityOptions,setEntityOptions]=useState<EntityOption[]>([]);
  const [resourceOptions,setResourceOptions]=useState<ExternalResourceOption[]>([]);
  const [expandedScene,setExpandedScene]=useState<string|null>(null);
  const [sceneForm,setSceneForm]=useState(emptyScene);
  const [encounterForms,setEncounterForms]=useState<Record<string,typeof emptyEncounter>>({});
  const [entityForms,setEntityForms]=useState<Record<string,{entityId:string;role:string}>>({});
  const [handoutForm,setHandoutForm]=useState(emptyHandout);
  const [error,setError]=useState('');

  useEffect(()=>{if(!id)return;void api<{item:{name:string;worldId:string|null;permissions:{edit:boolean}}}>(`/vault/${id}`).then((result)=>{setAdventureName(result.item.name);setAdventureWorldId(result.item.worldId);}).catch(()=>{});},[id]);
  useEffect(()=>{void api<{items:EntityOption[]}>('/vault?pageSize=100&sort=name').then((result)=>setEntityOptions(result.items)).catch(()=>{});},[]);
  useEffect(()=>{if(adventureWorldId)void api<{items:ExternalResourceOption[]}>(`/external-resources/${adventureWorldId}`).then((result)=>setResourceOptions(result.items)).catch(()=>{});},[adventureWorldId]);

  const load=()=>resource.reload();
  if(!id)return null;
  if(resource.status!=='success')return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const {scenes,handouts}=resource.data;

  const createScene=async(event:FormEvent)=>{event.preventDefault();setError('');
    try{await postJson(`/adventures/${id}/scenes`,{...sceneForm,sortOrder:scenes.length});setSceneForm(emptyScene);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar a cena.');}
  };
  const toggleSceneCompleted=async(scene:Scene)=>{setError('');
    try{await patchJson(`/adventures/${id}/scenes/${scene.id}`,{act:scene.act,title:scene.title,summary:scene.summary,readAloud:scene.readAloud,gmNotes:scene.gmNotes,completed:!scene.completed,sortOrder:scene.sortOrder});load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar a cena.');}
  };
  const removeScene=async(sceneId:string)=>{if(!confirm('Excluir esta cena e tudo dentro dela (encontros, vínculos)?'))return;setError('');
    try{await deleteApi(`/adventures/${id}/scenes/${sceneId}`);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir a cena.');}
  };
  const createEncounter=async(scene:Scene,event:FormEvent)=>{event.preventDefault();setError('');
    const form=encounterForms[scene.id]??emptyEncounter;
    try{await postJson(`/adventures/${id}/scenes/${scene.id}/encounters`,{...form,sortOrder:scene.encounters.length});setEncounterForms((current)=>({...current,[scene.id]:emptyEncounter}));load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar o encontro.');}
  };
  const removeEncounter=async(sceneId:string,encounterId:string)=>{setError('');
    try{await deleteApi(`/adventures/${id}/scenes/${sceneId}/encounters/${encounterId}`);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir o encontro.');}
  };
  const linkEntity=async(scene:Scene,event:FormEvent)=>{event.preventDefault();setError('');
    const form=entityForms[scene.id];if(!form?.entityId)return;
    try{await postJson(`/adventures/${id}/scenes/${scene.id}/entities`,form);setEntityForms((current)=>({...current,[scene.id]:{entityId:'',role:''}}));load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível vincular a entidade.');}
  };
  const unlinkEntity=async(sceneId:string,entityId:string)=>{setError('');
    try{await deleteApi(`/adventures/${id}/scenes/${sceneId}/entities/${entityId}`);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível desvincular.');}
  };
  const createHandout=async(event:FormEvent)=>{event.preventDefault();setError('');
    try{await postJson(`/adventures/${id}/handouts`,{...handoutForm,sceneId:handoutForm.sceneId||null,externalResourceId:handoutForm.externalResourceId||null,sortOrder:handouts.length});setHandoutForm(emptyHandout);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar o handout.');}
  };
  const toggleHandoutRevealed=async(handout:Handout)=>{setError('');
    try{await patchJson(`/adventures/${id}/handouts/${handout.id}`,{title:handout.title,content:handout.content,sceneId:handout.sceneId,externalResourceId:handout.externalResourceId,revealed:!handout.revealed,sortOrder:handout.sortOrder});load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar o handout.');}
  };
  const removeHandout=async(handoutId:string)=>{setError('');
    try{await deleteApi(`/adventures/${id}/handouts/${handoutId}`);load();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir o handout.');}
  };

  return <div className="page">
    <PageHeader eyebrow="Preparação da Aventura" title={adventureName||'Aventura'} description="Estruture atos, cenas, encontros e handouts sem duplicar entidades já cadastradas no Vault." action={<Link className="ghost-button link-button" to={`/app/vault/${id}`}>Voltar à entidade</Link>}/>
    {error&&<p className="form-error">{error}</p>}

    <section className="panel">
      <h2><Swords size={20}/>Cenas</h2>
      {scenes.length===0&&<p>Nenhuma cena criada ainda.</p>}
      <ul className="clean-list adventure-scene-list">
        {scenes.map((scene)=><li key={scene.id} className="adventure-scene">
          <div className="section-heading">
            <div>
              <strong>{scene.act?`${scene.act} · `:''}{scene.title}</strong>
              <p className="section-note">{scene.summary||'Sem resumo.'}</p>
            </div>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={()=>void toggleSceneCompleted(scene)}>{scene.completed?<Check size={16}/>:null}{scene.completed?'Concluída':'Marcar concluída'}</button>
              <button type="button" className="icon-button" aria-label={expandedScene===scene.id?'Recolher cena':'Expandir cena'} onClick={()=>setExpandedScene(expandedScene===scene.id?null:scene.id)}>{expandedScene===scene.id?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>
              <button type="button" className="icon-button" aria-label={`Excluir cena ${scene.title}`} onClick={()=>void removeScene(scene.id)}><Trash2 size={17}/></button>
            </div>
          </div>
          {expandedScene===scene.id&&<div className="adventure-scene-body">
            {scene.readAloud&&<><h4>Texto para ler em voz alta</h4><p className="pre-wrap">{scene.readAloud}</p></>}
            {scene.gmNotes&&<><h4>Notas do mestre</h4><p className="pre-wrap">{scene.gmNotes}</p></>}
            <h4>Encontros</h4>
            {scene.encounters.length?<ul className="clean-list">{scene.encounters.map((encounter)=><li key={encounter.id}><span><strong>{encounter.name}</strong>{encounter.difficulty&&<small> · {encounter.difficulty}</small>}<p>{encounter.description}</p></span><button className="ghost-button" onClick={()=>void removeEncounter(scene.id,encounter.id)}><Trash2 size={15}/></button></li>)}</ul>:<p>Nenhum encontro nesta cena.</p>}
            <form className="inline-form" onSubmit={(event)=>void createEncounter(scene,event)}>
              <label>Nome<input required maxLength={160} value={encounterForms[scene.id]?.name??''} onChange={(event)=>setEncounterForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyEncounter),name:event.target.value}}))}/></label>
              <label>Dificuldade<input maxLength={80} value={encounterForms[scene.id]?.difficulty??''} onChange={(event)=>setEncounterForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyEncounter),difficulty:event.target.value}}))}/></label>
              <button className="secondary-button"><Plus size={16}/>Adicionar encontro</button>
            </form>
            <h4>Entidades nesta cena</h4>
            {scene.entities.length?<ul className="clean-list">{scene.entities.map((entity)=><li key={entity.entityId}><span><Link to={`/app/vault/${entity.entityId}`}>{entity.entityName}</Link><small> · {displayLabel(entity.entityType)}{entity.role?` · ${entity.role}`:''}</small></span><button className="ghost-button" onClick={()=>void unlinkEntity(scene.id,entity.entityId)}>Desvincular</button></li>)}</ul>:<p>Nenhuma entidade vinculada.</p>}
            <form className="inline-form" onSubmit={(event)=>void linkEntity(scene,event)}>
              <label>Entidade do Vault<select required value={entityForms[scene.id]?.entityId??''} onChange={(event)=>setEntityForms((current)=>({...current,[scene.id]:{entityId:event.target.value,role:current[scene.id]?.role??''}}))}><option value="">Selecione</option>{entityOptions.map((entityOption)=><option key={entityOption.id} value={entityOption.id}>{entityOption.name} ({displayLabel(entityOption.entityType)})</option>)}</select></label>
              <label>Papel na cena<input maxLength={120} placeholder="ex: antagonista" value={entityForms[scene.id]?.role??''} onChange={(event)=>setEntityForms((current)=>({...current,[scene.id]:{entityId:current[scene.id]?.entityId??'',role:event.target.value}}))}/></label>
              <button className="secondary-button"><Plus size={16}/>Vincular</button>
            </form>
          </div>}
        </li>)}
      </ul>
      <form className="panel template-form" onSubmit={createScene}>
        <h3>Nova cena</h3>
        <label>Ato (opcional)<input maxLength={120} placeholder="ex: Ato 1" value={sceneForm.act} onChange={(event)=>setSceneForm({...sceneForm,act:event.target.value})}/></label>
        <label>Título<input required maxLength={160} value={sceneForm.title} onChange={(event)=>setSceneForm({...sceneForm,title:event.target.value})}/></label>
        <label>Resumo<textarea rows={2} maxLength={2000} value={sceneForm.summary} onChange={(event)=>setSceneForm({...sceneForm,summary:event.target.value})}/></label>
        <label>Texto para ler em voz alta<textarea rows={3} maxLength={5000} value={sceneForm.readAloud} onChange={(event)=>setSceneForm({...sceneForm,readAloud:event.target.value})}/></label>
        <label>Notas do mestre<textarea rows={3} maxLength={10000} value={sceneForm.gmNotes} onChange={(event)=>setSceneForm({...sceneForm,gmNotes:event.target.value})}/></label>
        <button className="primary-button">Criar cena</button>
      </form>
    </section>

    <section className="panel">
      <h2><FileText size={20}/>Handouts</h2>
      {handouts.length?<ul className="clean-list">{handouts.map((handout)=><li key={handout.id}>
        <span><strong>{handout.title}</strong><small>{handout.revealed?' · revelado aos jogadores':' · ainda não revelado'}{handout.externalResourceTitle?` · ${handout.externalResourceTitle}`:''}</small><p className="pre-wrap">{handout.content}</p></span>
        <div className="button-row"><button className="ghost-button" onClick={()=>void toggleHandoutRevealed(handout)}>{handout.revealed?'Ocultar':'Revelar'}</button><button className="ghost-button" onClick={()=>void removeHandout(handout.id)}><Trash2 size={15}/></button></div>
      </li>)}</ul>:<p>Nenhum handout criado.</p>}
      <form className="panel template-form" onSubmit={createHandout}>
        <h3>Novo handout</h3>
        <label>Título<input required maxLength={160} value={handoutForm.title} onChange={(event)=>setHandoutForm({...handoutForm,title:event.target.value})}/></label>
        <label>Conteúdo<textarea rows={4} maxLength={10000} value={handoutForm.content} onChange={(event)=>setHandoutForm({...handoutForm,content:event.target.value})}/></label>
        <label>Cena (opcional)<select value={handoutForm.sceneId} onChange={(event)=>setHandoutForm({...handoutForm,sceneId:event.target.value})}><option value="">Nenhuma</option>{scenes.map((scene)=><option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
        {resourceOptions.length>0&&<label>Recurso externo (opcional)<select value={handoutForm.externalResourceId} onChange={(event)=>setHandoutForm({...handoutForm,externalResourceId:event.target.value})}><option value="">Nenhum</option>{resourceOptions.map((option)=><option key={option.id} value={option.id}>{option.title}</option>)}</select></label>}
        <button className="primary-button">Criar handout</button>
      </form>
    </section>
  </div>;
}
