import { NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ClientApiError, deleteApi, postJson, putJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { SHEET_FIELD_TYPES, type SheetFieldType } from '../../domain/sheets';
import { Empty, Loading, PageHeader } from './dashboard-page';

// F-020 (BATCH9): Character Sheet Engine base — ver src/server/routes/sheets.ts. Modelos
// (sheet_templates) são reutilizáveis entre Personagens/NPCs; a ficha em si
// (character_sheets) é 1:1 com a entidade, editável apenas pelo dono (mesmo limite de
// "não existe co-edição de Vault Entity" já documentado em vault-pages.tsx).

export interface SheetFieldDefinition { key:string; label:string; type:SheetFieldType; required:boolean; options?:string[] }
export interface SheetTemplateSummary { id:string; worldId:string|null; worldName:string|null; gameSystemId:string|null; gameSystemName:string|null; name:string; description:string; version:number; fields:SheetFieldDefinition[] }
export interface EntitySheet { entityId:string; templateId:string; templateName:string; templateVersion:number; currentTemplateVersion:number; outdated:boolean; fields:SheetFieldDefinition[]; values:Record<string,string|number|boolean>; createdAt:string; updatedAt:string }

const fieldTypeLabel:Record<SheetFieldType,string>={TEXT:'Texto',NUMBER:'Número',BOOLEAN:'Sim/Não',CHOICE:'Múltipla escolha'};

function formatSheetValue(field:SheetFieldDefinition,value:unknown):string {
  if(value===undefined||value==='')return '—';
  if(field.type==='BOOLEAN')return value?'Sim':'Não';
  return String(value);
}

// Painel somente-leitura embutido em VaultDetailPage (CHARACTER/NPC). Complementar — se
// falhar, não bloqueia a página principal (mesmo princípio já usado para metadata/backlinks
// em vault-pages.tsx).
export function EntitySheetPanel({entityId,entityType,canEdit}:{entityId:string;entityType:string;canEdit:boolean}){
  const applicable=entityType==='CHARACTER'||entityType==='NPC';
  const resource=useResource<{item:EntitySheet|null}>(applicable?`/sheets/entities/${entityId}`:null);
  if(!applicable)return null;
  if(resource.status!=='success')return null;
  const sheet=resource.data.item;
  return <section className="panel">
    <div className="section-heading">
      <div><h2><NotebookPen size={20}/>Ficha de personagem</h2>{sheet&&<p className="section-note">Modelo: {sheet.templateName}{sheet.outdated?' · modelo atualizado desde o preenchimento':''}</p>}</div>
      {canEdit&&<Link className="ghost-button link-button" to={`/app/vault/${entityId}/sheet`}>{sheet?'Editar ficha':'Vincular ficha'}</Link>}
    </div>
    {sheet?<dl>{sheet.fields.map((field)=><div key={field.key}><dt>{field.label}</dt><dd>{formatSheetValue(field,sheet.values[field.key])}</dd></div>)}</dl>:<p>Nenhuma ficha vinculada.</p>}
  </section>;
}

interface SheetEntityInfo { id:string; name:string; entityType:string; worldId:string|null; worldName:string|null; permissions:{edit:boolean} }

export function SheetEditorPage(){
  const {id}=useParams();const navigate=useNavigate();
  const [entity,setEntity]=useState<SheetEntityInfo>();
  const [templates,setTemplates]=useState<SheetTemplateSummary[]>([]);
  const [hadSheet,setHadSheet]=useState(false);
  const [templateId,setTemplateId]=useState('');
  const [values,setValues]=useState<Record<string,string|number|boolean>>({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [fieldErrors,setFieldErrors]=useState<Record<string,string[]>>({});

  useEffect(()=>{let active=true;
    Promise.all([
      api<{item:SheetEntityInfo}>(`/vault/${id}`),
      // F-023: compatibilidade (global + World + Game System resolvido) é decidida pelo
      // servidor — única fonte de verdade, reaproveitada pela validação do PUT.
      api<{items:SheetTemplateSummary[]}>(`/sheets/entities/${id}/templates`),
      api<{item:EntitySheet|null}>(`/sheets/entities/${id}`),
    ]).then(([entityResult,templatesResult,sheetResult])=>{if(!active)return;
      setEntity(entityResult.item);setTemplates(templatesResult.items);
      setHadSheet(Boolean(sheetResult.item));setTemplateId(sheetResult.item?.templateId??'');setValues(sheetResult.item?.values??{});
    }).catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Não foi possível carregar a ficha.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[id]);

  if(loading)return <Loading/>;
  if(!entity)return <p className="form-error">{error||'Entidade não encontrada.'}</p>;

  const compatibleTemplates=templates;
  const selectedTemplate=compatibleTemplates.find((template)=>template.id===templateId);
  const selectTemplate=(nextId:string)=>{setTemplateId(nextId);setValues({});setFieldErrors({});};
  const updateValue=(key:string,value:string|number|boolean)=>setValues((current)=>({...current,[key]:value}));

  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');setFieldErrors({});
    try{await putJson(`/sheets/entities/${id}`,{templateId,values});navigate(`/app/vault/${id}`);}
    catch(reason){
      if(reason instanceof ClientApiError&&reason.fields){setFieldErrors(reason.fields);setError('Revise os campos destacados.');}
      else setError(reason instanceof Error?reason.message:'Não foi possível salvar a ficha.');
    }
  };
  const remove=async()=>{if(!confirm('Remover a ficha vinculada a esta entidade?'))return;setError('');
    try{await deleteApi(`/sheets/entities/${id}`);navigate(`/app/vault/${id}`);}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível remover a ficha.');}
  };

  return <div className="page narrow">
    <PageHeader eyebrow="Ficha de personagem" title={entity.name} description="Escolha um modelo e preencha os campos definidos pelo sistema."/>
    <form className="panel form-grid" onSubmit={submit}>
      <label className="span-2">Modelo<select required value={templateId} onChange={(event)=>selectTemplate(event.target.value)}>
        <option value="">Selecione um modelo</option>
        {compatibleTemplates.map((template)=><option key={template.id} value={template.id}>{template.name}{template.gameSystemName?` (${template.gameSystemName})`:template.worldId?'':' (global)'}</option>)}
      </select></label>
      {compatibleTemplates.length===0&&<p className="section-note span-2">Nenhum modelo disponível para {entity.worldName??'Personagens sem World'}. <Link to="/app/sheets">Crie um modelo</Link> primeiro.</p>}
      {selectedTemplate?.fields.map((field)=><label key={field.key} className="span-2">
        {field.label}{field.required?' *':''}
        {field.type==='TEXT'&&<input maxLength={5000} value={String(values[field.key]??'')} onChange={(event)=>updateValue(field.key,event.target.value)}/>}
        {field.type==='NUMBER'&&<input type="number" value={values[field.key]===undefined||values[field.key]===''?'':Number(values[field.key])} onChange={(event)=>updateValue(field.key,event.target.value===''?'':Number(event.target.value))}/>}
        {field.type==='BOOLEAN'&&<input type="checkbox" checked={Boolean(values[field.key])} onChange={(event)=>updateValue(field.key,event.target.checked)}/>}
        {field.type==='CHOICE'&&<select value={String(values[field.key]??'')} onChange={(event)=>updateValue(field.key,event.target.value)}><option value="">Selecione</option>{(field.options??[]).map((option)=><option key={option} value={option}>{option}</option>)}</select>}
        {fieldErrors[field.key]&&<small className="field-error">{fieldErrors[field.key][0]}</small>}
      </label>)}
      {error&&<p className="form-error span-2">{error}</p>}
      <div className="form-actions span-2">
        <button type="button" className="ghost-button" onClick={()=>navigate(-1)}>Cancelar</button>
        {hadSheet&&<button type="button" className="danger-button" onClick={()=>void remove()}><Trash2 size={17}/>Remover ficha</button>}
        <button className="primary-button" disabled={!templateId}>Salvar ficha</button>
      </div>
    </form>
  </div>;
}

interface TemplateFormField { key:string; label:string; type:SheetFieldType; required:boolean; optionsText:string }
interface TemplateFormState { name:string; description:string; worldId:string; gameSystemId:string; fields:TemplateFormField[] }
const emptyField=():TemplateFormField=>({key:'',label:'',type:'TEXT',required:false,optionsText:''});
const blankForm:TemplateFormState={name:'',description:'',worldId:'',gameSystemId:'',fields:[emptyField()]};

export function SheetTemplatesPage(){
  const resource=useResource<SheetTemplateSummary[]>('/sheets/templates',async()=>(await api<{items:SheetTemplateSummary[]}>('/sheets/templates')).items);
  const [worlds,setWorlds]=useState<Array<{id:string;name:string}>>([]);
  const [gameSystems,setGameSystems]=useState<Array<{id:string;name:string}>>([]);
  const [form,setForm]=useState<TemplateFormState>(blankForm);
  const [error,setError]=useState('');
  useEffect(()=>{void api<{worlds:Array<{id:string;name:string}>}>('/vault/metadata').then((result)=>setWorlds(result.worlds)).catch(()=>{});},[]);
  useEffect(()=>{void api<{items:Array<{id:string;name:string}>}>('/sheets/game-systems').then((result)=>setGameSystems(result.items)).catch(()=>{});},[]);

  const updateField=(index:number,changes:Partial<TemplateFormField>)=>setForm((current)=>({...current,fields:current.fields.map((field,fieldIndex)=>fieldIndex===index?{...field,...changes}:field)}));
  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');
    const payload={
      name:form.name,description:form.description,worldId:form.worldId||null,gameSystemId:form.gameSystemId||null,
      fields:form.fields.map((field)=>({key:field.key,label:field.label,type:field.type,required:field.required,...(field.type==='CHOICE'?{options:field.optionsText.split(',').map((option)=>option.trim()).filter(Boolean)}:{})})),
    };
    try{await postJson('/sheets/templates',payload);setForm(blankForm);resource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível criar o modelo.');}
  };
  const remove=async(templateId:string)=>{setError('');
    try{await deleteApi(`/sheets/templates/${templateId}`);resource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir o modelo.');}
  };

  if(resource.status!=='success')return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const templates=resource.data;
  return <div className="page">
    <PageHeader eyebrow="Fichas" title="Modelos de ficha" description="Modelos neutros em relação a sistema — defina apenas os campos que a sua mesa usa. Um modelo sem World fica disponível para qualquer Personagem ou NPC do seu Vault."/>
    <section className="bestiary-layout">
      <div>
        <section className="panel template-list">
          <h2>Modelos existentes</h2>
          {templates.length?<ul className="clean-list">{templates.map((template)=><li key={template.id}>
            <span><strong>{template.name}</strong><small>{template.gameSystemName??template.worldName??'Global'} · {template.fields.length} campos · v{template.version}{template.description?` · ${template.description}`:''}</small></span>
            <button type="button" className="ghost-button" onClick={()=>void remove(template.id)}><Trash2 size={16}/>Excluir</button>
          </li>)}</ul>:<Empty title="Nenhum modelo criado" text="Crie o primeiro modelo de ficha para vincular a Personagens e NPCs." action="Ver Vault" to="/app/vault"/>}
        </section>
      </div>
      <form className="panel template-form" onSubmit={submit}>
        <h2>Novo modelo</h2>
        <label>Nome<input required maxLength={120} value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})}/></label>
        <label>Descrição<textarea rows={3} maxLength={2000} value={form.description} onChange={(event)=>setForm({...form,description:event.target.value})}/></label>
        <label>World (opcional)<select value={form.worldId} onChange={(event)=>setForm({...form,worldId:event.target.value,gameSystemId:event.target.value?'':form.gameSystemId})}><option value="">Global (qualquer World)</option>{worlds.map((world)=><option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        <label>Game System (opcional)<select value={form.gameSystemId} disabled={Boolean(form.worldId)} onChange={(event)=>setForm({...form,gameSystemId:event.target.value})}><option value="">Nenhum (usar World acima, se houver)</option>{gameSystems.map((system)=><option key={system.id} value={system.id}>{system.name}</option>)}</select>{gameSystems.length===0&&<small className="section-note">Nenhum Game System disponível ainda — cadastre um RPG na Biblioteca primeiro.</small>}</label>
        <div className="template-fields">
          <strong>Campos</strong>
          {form.fields.map((field,index)=><div className="template-field" key={index}>
            <label>Chave<input required pattern="[a-z][a-z0-9_]{0,39}" placeholder="ex: pontos_de_vida" value={field.key} onChange={(event)=>updateField(index,{key:event.target.value.toLowerCase().replaceAll(' ','_')})}/></label>
            <label>Rótulo<input required maxLength={80} placeholder="ex: Pontos de Vida" value={field.label} onChange={(event)=>updateField(index,{label:event.target.value})}/></label>
            <label>Tipo<select value={field.type} onChange={(event)=>updateField(index,{type:event.target.value as SheetFieldType})}>{SHEET_FIELD_TYPES.map((type)=><option key={type} value={type}>{fieldTypeLabel[type]}</option>)}</select></label>
            {field.type==='CHOICE'&&<label>Opções (separadas por vírgula)<input required maxLength={800} placeholder="ex: Cauteloso, Ousado" value={field.optionsText} onChange={(event)=>updateField(index,{optionsText:event.target.value})}/></label>}
            <label className="checkbox-row"><input type="checkbox" checked={field.required} onChange={(event)=>updateField(index,{required:event.target.checked})}/>Obrigatório</label>
            <button type="button" className="icon-button" aria-label={`Remover campo ${index+1}`} disabled={form.fields.length===1} onClick={()=>setForm((current)=>({...current,fields:current.fields.filter((_,fieldIndex)=>fieldIndex!==index)}))}><Trash2 size={17}/></button>
          </div>)}
        </div>
        <button type="button" className="ghost-button" onClick={()=>setForm((current)=>({...current,fields:[...current.fields,emptyField()]}))}><Plus size={17}/>Adicionar campo</button>
        {error&&<p className="form-error">{error}</p>}
        <button className="primary-button">Criar modelo</button>
      </form>
    </section>
  </div>;
}
