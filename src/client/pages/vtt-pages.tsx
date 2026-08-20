import { ChevronDown, ChevronUp, Map, Plus, Swords, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, deleteApi, patchJson, postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { PageHeader } from './dashboard-page';

// F-029/F-030/F-032 (BATCH16/17): VTT — fundação (Scene/Map/tokens) + fog of war + iniciativa/
// combate, sem realtime — ver src/server/routes/vtt.ts. Ferramenta de preparação/condução do
// GM: tudo aqui é owned-only (mesmo modelo do Diário/Adventures). A visão do jogador (o que
// efetivamente chega no Portal/Player View, F-033) usa GET /vtt/:campaignId/live, filtrado no
// servidor — não existe aqui ainda porque F-033 está bloqueada aguardando esta fundação.

interface Scene { id:string; mapId:string|null; title:string; imageUrl:string; notes:string; isActive:boolean; fogEnabled:boolean; gridCols:number; gridRows:number; combatActive:boolean; combatRound:number }
interface SceneDetail extends Scene { resolvedImageUrl:string }
interface Token { id:string; sceneId:string; entityId:string|null; entityName:string|null; entityType:string|null; label:string; x:number; y:number; visibleToPlayers:boolean }
interface FogCell { col:number; row:number }
interface Combatant { id:string; tokenId:string|null; name:string; initiative:number; hpCurrent:number|null; hpMax:number|null; notes:string; visibleToPlayers:boolean; isCurrentTurn:boolean }
interface WorldOption { id:string; name:string; isOwner:boolean }
interface MapOption { id:string; title:string }
interface EntityOption { id:string; name:string; entityType:string }

const emptyScene = { title:'', worldId:'', mapId:'', imageUrl:'', notes:'', fogEnabled:false, gridCols:'20', gridRows:'20' };
const emptyToken = { label:'', entityId:'', x:'50', y:'50', visibleToPlayers:false };
const emptyCombatant = { name:'', initiative:'10', hpCurrent:'', hpMax:'', visibleToPlayers:false };

export function VttPage(){
  const {id:campaignId}=useParams();
  const scenesResource=useResource<{items:Scene[]}>(campaignId?`/vtt/${campaignId}/scenes`:null);
  const [worldOptions,setWorldOptions]=useState<WorldOption[]>([]);
  const [mapOptions,setMapOptions]=useState<MapOption[]>([]);
  const [entityOptions,setEntityOptions]=useState<EntityOption[]>([]);
  const [sceneForm,setSceneForm]=useState(emptyScene);
  const [expandedSceneId,setExpandedSceneId]=useState<string|null>(null);
  const [sceneDetail,setSceneDetail]=useState<Record<string,{item:SceneDetail;tokens:Token[];fog:FogCell[];combatants:Combatant[]}>>({});
  const [tokenForms,setTokenForms]=useState<Record<string,typeof emptyToken>>({});
  const [combatantForms,setCombatantForms]=useState<Record<string,typeof emptyCombatant>>({});
  const [error,setError]=useState('');

  useEffect(()=>{void api<{items:WorldOption[]}>('/worlds?pageSize=50').then((result)=>setWorldOptions(result.items.filter((world)=>world.isOwner))).catch(()=>{});},[]);
  useEffect(()=>{void api<{items:EntityOption[]}>('/vault?pageSize=100&sort=name').then((result)=>setEntityOptions(result.items)).catch(()=>{});},[]);
  useEffect(()=>{
    // mapOptions só é exibido quando sceneForm.worldId está preenchido (ver JSX abaixo) — sem
    // World selecionado, o select de mapa some da tela, então não há necessidade de limpar o
    // array aqui (evita setState síncrono dentro do efeito).
    if(!sceneForm.worldId)return;
    void api<{items:MapOption[]}>(`/cartography/${sceneForm.worldId}`).then((result)=>setMapOptions(result.items)).catch(()=>setMapOptions([]));
  },[sceneForm.worldId]);

  if(!campaignId)return null;
  if(scenesResource.status!=='success')return <ResourceFallback state={scenesResource} onRetry={scenesResource.reload}/>;
  const scenes=scenesResource.data.items;

  const loadSceneDetail=async(sceneId:string)=>{
    try{const detail=await api<{item:SceneDetail;tokens:Token[];fog:FogCell[];combatants:Combatant[]}>(`/vtt/${campaignId}/scenes/${sceneId}`);setSceneDetail((current)=>({...current,[sceneId]:detail}));}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível carregar a cena.');}
  };
  const toggleExpand=(sceneId:string)=>{
    if(expandedSceneId===sceneId){setExpandedSceneId(null);return;}
    setExpandedSceneId(sceneId);
    void loadSceneDetail(sceneId);
  };
  const createScene=async(event:FormEvent)=>{event.preventDefault();setError('');
    try{
      await postJson(`/vtt/${campaignId}/scenes`,{title:sceneForm.title,mapId:sceneForm.mapId||null,imageUrl:sceneForm.mapId?'':sceneForm.imageUrl,notes:sceneForm.notes,fogEnabled:sceneForm.fogEnabled,gridCols:Number(sceneForm.gridCols||20),gridRows:Number(sceneForm.gridRows||20)});
      setSceneForm(emptyScene);scenesResource.reload();
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar a cena.');}
  };
  const removeScene=async(scene:Scene)=>{if(!confirm(`Excluir a cena "${scene.title}" e todos os tokens dentro dela?`))return;setError('');
    try{await deleteApi(`/vtt/${campaignId}/scenes/${scene.id}`);scenesResource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir a cena.');}
  };
  const activateScene=async(sceneId:string)=>{setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/activate`,{});scenesResource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível ativar a cena.');}
  };
  const deactivateScene=async(sceneId:string)=>{setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/deactivate`,{});scenesResource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível encerrar a cena.');}
  };
  const createToken=async(sceneId:string,event:FormEvent)=>{event.preventDefault();setError('');
    const form=tokenForms[sceneId]??emptyToken;if(!form.label)return;
    try{
      await postJson(`/vtt/${campaignId}/scenes/${sceneId}/tokens`,{label:form.label,entityId:form.entityId||null,x:Number(form.x||50),y:Number(form.y||50),visibleToPlayers:form.visibleToPlayers});
      setTokenForms((current)=>({...current,[sceneId]:emptyToken}));void loadSceneDetail(sceneId);
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar o token.');}
  };
  const toggleTokenVisible=async(sceneId:string,token:Token)=>{setError('');
    try{await patchJson(`/vtt/${campaignId}/scenes/${sceneId}/tokens/${token.id}`,{label:token.label,entityId:token.entityId,x:token.x,y:token.y,visibleToPlayers:!token.visibleToPlayers});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar o token.');}
  };
  const removeToken=async(sceneId:string,tokenId:string)=>{setError('');
    try{await deleteApi(`/vtt/${campaignId}/scenes/${sceneId}/tokens/${tokenId}`);void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir o token.');}
  };
  const toggleFogCell=async(sceneId:string,col:number,row:number,revealed:boolean)=>{setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/fog/${revealed?'hide':'reveal'}`,{col,row});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar a névoa.');}
  };
  const resetFog=async(sceneId:string)=>{if(!confirm('Reencobrir a cena inteira?'))return;setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/fog/reset`,{});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível reencobrir a cena.');}
  };
  const combatantPayload=(form:typeof emptyCombatant)=>({tokenId:null,name:form.name,initiative:Number(form.initiative||0),hpCurrent:form.hpCurrent?Number(form.hpCurrent):null,hpMax:form.hpMax?Number(form.hpMax):null,notes:'',visibleToPlayers:form.visibleToPlayers});
  const startCombat=async(sceneId:string,event:FormEvent)=>{event.preventDefault();setError('');
    const form=combatantForms[sceneId]??emptyCombatant;if(!form.name)return;
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/combat/start`,{combatants:[combatantPayload(form)]});setCombatantForms((current)=>({...current,[sceneId]:emptyCombatant}));void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível iniciar o combate.');}
  };
  const addCombatant=async(sceneId:string,event:FormEvent)=>{event.preventDefault();setError('');
    const form=combatantForms[sceneId]??emptyCombatant;if(!form.name)return;
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants`,combatantPayload(form));setCombatantForms((current)=>({...current,[sceneId]:emptyCombatant}));void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível adicionar o combatente.');}
  };
  const nextTurn=async(sceneId:string)=>{setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/combat/next`,{});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível avançar o turno.');}
  };
  const endCombat=async(sceneId:string)=>{if(!confirm('Encerrar o combate? Os combatentes serão removidos (o combate não fica no histórico).'))return;setError('');
    try{await postJson(`/vtt/${campaignId}/scenes/${sceneId}/combat/end`,{});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível encerrar o combate.');}
  };
  const adjustHp=async(sceneId:string,combatant:Combatant,delta:number)=>{setError('');
    const hpCurrent=combatant.hpCurrent===null?null:combatant.hpCurrent+delta;
    try{await patchJson(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants/${combatant.id}`,{tokenId:combatant.tokenId,name:combatant.name,initiative:combatant.initiative,hpCurrent,hpMax:combatant.hpMax,notes:combatant.notes,visibleToPlayers:combatant.visibleToPlayers});void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível atualizar o PV.');}
  };
  const removeCombatant=async(sceneId:string,combatantId:string)=>{setError('');
    try{await deleteApi(`/vtt/${campaignId}/scenes/${sceneId}/combat/combatants/${combatantId}`);void loadSceneDetail(sceneId);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível remover o combatente.');}
  };

  return <div className="page">
    <PageHeader eyebrow="Mesa Virtual" title="VTT — cenas e tokens" description="Prepare cenas com mapa e tokens, e controle o que cada jogador enxerga. Ainda sem sincronização em tempo real (F-031)." action={<Link className="ghost-button link-button" to={`/app/campaigns/${campaignId}`}>Voltar à campanha</Link>}/>
    {error&&<p className="form-error">{error}</p>}

    <section className="panel">
      <h2><Map size={20}/>Cenas</h2>
      {scenes.length===0&&<p>Nenhuma cena criada ainda.</p>}
      <ul className="clean-list adventure-scene-list">
        {scenes.map((scene)=><li key={scene.id} className="adventure-scene">
          <div className="section-heading">
            <div>
              <strong>{scene.title}</strong>{scene.isActive&&<span className="badge">Ao vivo</span>}
              <p className="section-note">{scene.notes||'Sem notas.'}</p>
            </div>
            <div className="button-row">
              {scene.isActive
                ?<button type="button" className="ghost-button" onClick={()=>void deactivateScene(scene.id)}>Encerrar</button>
                :<button type="button" className="ghost-button" onClick={()=>void activateScene(scene.id)}>Ativar para os jogadores</button>}
              <button type="button" className="icon-button" aria-label={expandedSceneId===scene.id?'Recolher cena':'Expandir cena'} onClick={()=>toggleExpand(scene.id)}>{expandedSceneId===scene.id?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>
              <button type="button" className="icon-button" aria-label={`Excluir cena ${scene.title}`} onClick={()=>void removeScene(scene)}><Trash2 size={17}/></button>
            </div>
          </div>
          {expandedSceneId===scene.id&&sceneDetail[scene.id]&&<div className="adventure-scene-body">
            {sceneDetail[scene.id].item.resolvedImageUrl
              ?<div className="cartography-image-wrap">
                <img src={sceneDetail[scene.id].item.resolvedImageUrl} alt={scene.title} referrerPolicy="no-referrer"/>
                {sceneDetail[scene.id].item.fogEnabled&&<div className="vtt-fog-grid" style={{gridTemplateColumns:`repeat(${sceneDetail[scene.id].item.gridCols},1fr)`,gridTemplateRows:`repeat(${sceneDetail[scene.id].item.gridRows},1fr)`}}>
                  {Array.from({length:sceneDetail[scene.id].item.gridCols*sceneDetail[scene.id].item.gridRows}).map((_,index)=>{
                    const cols=sceneDetail[scene.id].item.gridCols;
                    const col=index%cols, row=Math.floor(index/cols);
                    const revealed=sceneDetail[scene.id].fog.some((cell)=>cell.col===col&&cell.row===row);
                    return <button key={`${col}-${row}`} type="button" className={`vtt-fog-cell ${revealed?'vtt-fog-cell-revealed':''}`} aria-label={`Névoa ${col},${row} ${revealed?'revelada':'oculta'}`} onClick={()=>void toggleFogCell(scene.id,col,row,revealed)}/>;
                  })}
                </div>}
                {sceneDetail[scene.id].tokens.map((token)=><button key={token.id} type="button" className={`vtt-token ${token.visibleToPlayers?'':'vtt-token-hidden'}`} style={{left:`${token.x}%`,top:`${token.y}%`}} aria-label={`Token ${token.label}${token.visibleToPlayers?' (visível aos jogadores)':' (oculto)'}`} title={token.label} onClick={()=>void toggleTokenVisible(scene.id,token)}>{token.label.slice(0,2).toUpperCase()}</button>)}
              </div>
              :<p>Sem imagem de fundo.</p>}
            {sceneDetail[scene.id].item.fogEnabled&&<p className="section-note">Névoa da guerra ativa — clique nas células para revelar/ocultar. <button type="button" className="ghost-button" onClick={()=>void resetFog(scene.id)}>Reencobrir tudo</button></p>}
            <h4>Tokens</h4>
            {sceneDetail[scene.id].tokens.length
              ?<ul className="clean-list">{sceneDetail[scene.id].tokens.map((token)=><li key={token.id}>
                <span><strong>{token.label}</strong>{token.entityName&&<> · <Link to={`/app/vault/${token.entityId}`}>{token.entityName}</Link></>}<small>{token.visibleToPlayers?' · visível aos jogadores':' · oculto (GM only)'}</small></span>
                <div className="button-row">
                  <button type="button" className="ghost-button" onClick={()=>void toggleTokenVisible(scene.id,token)}>{token.visibleToPlayers?'Ocultar':'Revelar'}</button>
                  <button type="button" className="ghost-button" aria-label={`Excluir token ${token.label}`} onClick={()=>void removeToken(scene.id,token.id)}><Trash2 size={15}/></button>
                </div>
              </li>)}</ul>
              :<p>Nenhum token nesta cena.</p>}
            <form className="inline-form" onSubmit={(event)=>void createToken(scene.id,event)}>
              <label>Rótulo<input required maxLength={160} value={tokenForms[scene.id]?.label??''} onChange={(event)=>setTokenForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyToken),label:event.target.value}}))}/></label>
              <label>Entidade (opcional)<select value={tokenForms[scene.id]?.entityId??''} onChange={(event)=>setTokenForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyToken),entityId:event.target.value}}))}><option value="">Nenhuma</option>{entityOptions.map((entityOption)=><option key={entityOption.id} value={entityOption.id}>{entityOption.name}</option>)}</select></label>
              <label>X (%)<input type="number" min={0} max={100} step={0.1} value={tokenForms[scene.id]?.x??'50'} onChange={(event)=>setTokenForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyToken),x:event.target.value}}))}/></label>
              <label>Y (%)<input type="number" min={0} max={100} step={0.1} value={tokenForms[scene.id]?.y??'50'} onChange={(event)=>setTokenForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyToken),y:event.target.value}}))}/></label>
              <label className="checkbox-row"><input type="checkbox" checked={tokenForms[scene.id]?.visibleToPlayers??false} onChange={(event)=>setTokenForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyToken),visibleToPlayers:event.target.checked}}))}/>Visível aos jogadores</label>
              <button className="secondary-button"><Plus size={16}/>Adicionar token</button>
            </form>

            <h4><Swords size={16}/>Combate {sceneDetail[scene.id].item.combatActive&&<span className="badge">Round {sceneDetail[scene.id].item.combatRound}</span>}</h4>
            {sceneDetail[scene.id].item.combatActive?<>
              <ul className="clean-list">{sceneDetail[scene.id].combatants.map((combatant)=><li key={combatant.id}>
                <span>
                  {combatant.isCurrentTurn&&<span className="badge">Turno atual</span>} <strong>{combatant.name}</strong> · iniciativa {combatant.initiative}
                  {combatant.hpMax!==null&&<> · PV {combatant.hpCurrent??'?'}/{combatant.hpMax}</>}
                  <small>{combatant.visibleToPlayers?' · visível aos jogadores':' · oculto (GM only)'}</small>
                </span>
                <div className="button-row">
                  {combatant.hpCurrent!==null&&<>
                    <button type="button" className="icon-button" aria-label={`Reduzir PV de ${combatant.name}`} onClick={()=>void adjustHp(scene.id,combatant,-1)}>-1</button>
                    <button type="button" className="icon-button" aria-label={`Aumentar PV de ${combatant.name}`} onClick={()=>void adjustHp(scene.id,combatant,1)}>+1</button>
                  </>}
                  <button type="button" className="ghost-button" aria-label={`Remover ${combatant.name} do combate`} onClick={()=>void removeCombatant(scene.id,combatant.id)}><Trash2 size={15}/></button>
                </div>
              </li>)}</ul>
              <div className="button-row">
                <button type="button" className="primary-button" onClick={()=>void nextTurn(scene.id)}>Próximo turno</button>
                <button type="button" className="ghost-button" onClick={()=>void endCombat(scene.id)}>Encerrar combate</button>
              </div>
              <form className="inline-form" onSubmit={(event)=>void addCombatant(scene.id,event)}>
                <label>Nome<input required maxLength={160} value={combatantForms[scene.id]?.name??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),name:event.target.value}}))}/></label>
                <label>Iniciativa<input type="number" step={0.1} value={combatantForms[scene.id]?.initiative??'10'} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),initiative:event.target.value}}))}/></label>
                <label>PV atual<input type="number" value={combatantForms[scene.id]?.hpCurrent??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),hpCurrent:event.target.value}}))}/></label>
                <label>PV máximo<input type="number" min={1} value={combatantForms[scene.id]?.hpMax??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),hpMax:event.target.value}}))}/></label>
                <label className="checkbox-row"><input type="checkbox" checked={combatantForms[scene.id]?.visibleToPlayers??false} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),visibleToPlayers:event.target.checked}}))}/>Visível aos jogadores</label>
                <button className="secondary-button"><Plus size={16}/>Adicionar combatente</button>
              </form>
            </>:<form className="inline-form" onSubmit={(event)=>void startCombat(scene.id,event)}>
              <label>Primeiro combatente<input required maxLength={160} placeholder="Nome" value={combatantForms[scene.id]?.name??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),name:event.target.value}}))}/></label>
              <label>Iniciativa<input type="number" step={0.1} value={combatantForms[scene.id]?.initiative??'10'} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),initiative:event.target.value}}))}/></label>
              <label>PV atual<input type="number" value={combatantForms[scene.id]?.hpCurrent??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),hpCurrent:event.target.value}}))}/></label>
              <label>PV máximo<input type="number" min={1} value={combatantForms[scene.id]?.hpMax??''} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),hpMax:event.target.value}}))}/></label>
              <label className="checkbox-row"><input type="checkbox" checked={combatantForms[scene.id]?.visibleToPlayers??false} onChange={(event)=>setCombatantForms((current)=>({...current,[scene.id]:{...(current[scene.id]??emptyCombatant),visibleToPlayers:event.target.checked}}))}/>Visível aos jogadores</label>
              <button className="secondary-button"><Swords size={16}/>Iniciar combate</button>
            </form>}
          </div>}
        </li>)}
      </ul>
      <form className="panel template-form" onSubmit={createScene}>
        <h3>Nova cena</h3>
        <label>Título<input required maxLength={160} value={sceneForm.title} onChange={(event)=>setSceneForm({...sceneForm,title:event.target.value})}/></label>
        <label>World (para usar um mapa da Cartografia, opcional)<select value={sceneForm.worldId} onChange={(event)=>setSceneForm({...sceneForm,worldId:event.target.value,mapId:''})}><option value="">Nenhum</option>{worldOptions.map((world)=><option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        {sceneForm.worldId&&<label>Mapa<select value={sceneForm.mapId} onChange={(event)=>setSceneForm({...sceneForm,mapId:event.target.value})}><option value="">Nenhum (usar URL de imagem abaixo)</option>{mapOptions.map((mapOption)=><option key={mapOption.id} value={mapOption.id}>{mapOption.title}</option>)}</select></label>}
        {!sceneForm.mapId&&<label>URL da imagem de fundo<input maxLength={2000} placeholder="https://..." value={sceneForm.imageUrl} onChange={(event)=>setSceneForm({...sceneForm,imageUrl:event.target.value})}/></label>}
        <label>Notas<textarea rows={2} maxLength={2000} value={sceneForm.notes} onChange={(event)=>setSceneForm({...sceneForm,notes:event.target.value})}/></label>
        <label className="checkbox-row"><input type="checkbox" checked={sceneForm.fogEnabled} onChange={(event)=>setSceneForm({...sceneForm,fogEnabled:event.target.checked})}/>Névoa da guerra (F-030) — a cena começa totalmente encoberta para os jogadores</label>
        {sceneForm.fogEnabled&&<><label>Colunas da grade<input type="number" min={1} max={100} value={sceneForm.gridCols} onChange={(event)=>setSceneForm({...sceneForm,gridCols:event.target.value})}/></label>
        <label>Linhas da grade<input type="number" min={1} max={100} value={sceneForm.gridRows} onChange={(event)=>setSceneForm({...sceneForm,gridRows:event.target.value})}/></label></>}
        <button className="primary-button">Criar cena</button>
      </form>
    </section>
  </div>;
}
