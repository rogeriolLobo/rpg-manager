import { Download, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ClientApiError, deleteApi, patchJson, postJson, putJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { SHEET_FIELD_TYPES, type PdfFieldMapping, type SheetFieldType } from '../../domain/sheets';
import { detectAcroFormFields, fillSheetPdf, triggerPdfDownload } from '../pdf/sheet-pdf';
import { Empty, Loading, PageHeader } from './dashboard-page';

// F-020 (BATCH9): Character Sheet Engine base — ver src/server/routes/sheets.ts. Modelos
// (sheet_templates) são reutilizáveis entre Personagens/NPCs; a ficha em si
// (character_sheets) é 1:1 com a entidade, editável apenas pelo dono (mesmo limite de
// "não existe co-edição de Vault Entity" já documentado em vault-pages.tsx).
// F-021 (BATCH11): fichas em PDF — o PDF em si NUNCA passa pelo nosso servidor, ver
// src/client/pdf/sheet-pdf.ts.

export interface SheetFieldDefinition { key:string; label:string; type:SheetFieldType; required:boolean; options?:string[] }
export interface SheetTemplateSummary { id:string; worldId:string|null; worldName:string|null; gameSystemId:string|null; gameSystemName:string|null; name:string; description:string; version:number; fields:SheetFieldDefinition[]; pdfUrl:string|null; pdfMapping:Record<string,PdfFieldMapping> }
export interface EntitySheet { entityId:string; templateId:string; templateName:string; templateVersion:number; currentTemplateVersion:number; outdated:boolean; fields:SheetFieldDefinition[]; values:Record<string,string|number|boolean>; pdfUrl:string|null; pdfMapping:Record<string,PdfFieldMapping>; createdAt:string; updatedAt:string }

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
  const [pdfError,setPdfError]=useState('');
  const [downloading,setDownloading]=useState(false);
  if(!applicable)return null;
  if(resource.status!=='success')return null;
  const sheet=resource.data.item;
  const downloadPdf=async()=>{if(!sheet?.pdfUrl)return;setPdfError('');setDownloading(true);
    try{
      const {bytes,warnings}=await fillSheetPdf(sheet.pdfUrl,sheet.fields,sheet.pdfMapping,sheet.values);
      triggerPdfDownload(bytes,`ficha-${entityId}.pdf`);
      if(warnings.length)setPdfError(warnings.join(' '));
    }catch(reason){setPdfError(reason instanceof Error?reason.message:'Não foi possível gerar o PDF.');}
    finally{setDownloading(false);}
  };
  return <section className="panel">
    <div className="section-heading">
      <div><h2><NotebookPen size={20}/>Ficha de personagem</h2>{sheet&&<p className="section-note">Modelo: {sheet.templateName}{sheet.outdated?' · modelo atualizado desde o preenchimento':''}</p>}</div>
      <div className="button-row">
        {sheet?.pdfUrl&&<button type="button" className="ghost-button" disabled={downloading} onClick={()=>void downloadPdf()}><Download size={16}/>{downloading?'Gerando…':'Baixar PDF preenchido'}</button>}
        {canEdit&&<Link className="ghost-button link-button" to={`/app/vault/${entityId}/sheet`}>{sheet?'Editar ficha':'Vincular ficha'}</Link>}
      </div>
    </div>
    {sheet?<dl>{sheet.fields.map((field)=><div key={field.key}><dt>{field.label}</dt><dd>{formatSheetValue(field,sheet.values[field.key])}</dd></div>)}</dl>:<p>Nenhuma ficha vinculada.</p>}
    {pdfError&&<p className="form-error">{pdfError}</p>}
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

interface TemplateFormField { key:string; label:string; type:SheetFieldType; required:boolean; optionsText:string; pdfMode:''|'ACROFORM'|'OVERLAY'; pdfFieldName:string; pdfPage:string; pdfX:string; pdfY:string; pdfFontSize:string }
interface TemplateFormState { name:string; description:string; worldId:string; gameSystemId:string; pdfUrl:string; fields:TemplateFormField[] }
const emptyField=():TemplateFormField=>({key:'',label:'',type:'TEXT',required:false,optionsText:'',pdfMode:'',pdfFieldName:'',pdfPage:'',pdfX:'',pdfY:'',pdfFontSize:''});
const blankForm:TemplateFormState={name:'',description:'',worldId:'',gameSystemId:'',pdfUrl:'',fields:[emptyField()]};

function toFormFields(template:SheetTemplateSummary):TemplateFormField[] {
  return template.fields.map((field)=>{
    const mapping=template.pdfMapping[field.key];
    return {
      key:field.key,label:field.label,type:field.type,required:field.required,optionsText:(field.options??[]).join(', '),
      pdfMode:mapping?.mode??'',
      pdfFieldName:mapping?.mode==='ACROFORM'?mapping.fieldName:'',
      pdfPage:mapping?.mode==='OVERLAY'?String(mapping.page):'',
      pdfX:mapping?.mode==='OVERLAY'?String(mapping.x):'',
      pdfY:mapping?.mode==='OVERLAY'?String(mapping.y):'',
      pdfFontSize:mapping?.mode==='OVERLAY'&&mapping.fontSize!==undefined?String(mapping.fontSize):'',
    };
  });
}

export function SheetTemplatesPage(){
  const resource=useResource<SheetTemplateSummary[]>('/sheets/templates',async()=>(await api<{items:SheetTemplateSummary[]}>('/sheets/templates')).items);
  const [worlds,setWorlds]=useState<Array<{id:string;name:string}>>([]);
  const [gameSystems,setGameSystems]=useState<Array<{id:string;name:string}>>([]);
  const [form,setForm]=useState<TemplateFormState>(blankForm);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [detectedFields,setDetectedFields]=useState<string[]>([]);
  const [detecting,setDetecting]=useState(false);
  useEffect(()=>{void api<{worlds:Array<{id:string;name:string}>}>('/vault/metadata').then((result)=>setWorlds(result.worlds)).catch(()=>{});},[]);
  useEffect(()=>{void api<{items:Array<{id:string;name:string}>}>('/sheets/game-systems').then((result)=>setGameSystems(result.items)).catch(()=>{});},[]);

  const updateField=(index:number,changes:Partial<TemplateFormField>)=>setForm((current)=>({...current,fields:current.fields.map((field,fieldIndex)=>fieldIndex===index?{...field,...changes}:field)}));
  const resetForm=()=>{setForm(blankForm);setEditingId(null);setDetectedFields([]);setError('');};
  const editTemplate=(template:SheetTemplateSummary)=>{
    setForm({name:template.name,description:template.description,worldId:template.worldId??'',gameSystemId:template.gameSystemId??'',pdfUrl:template.pdfUrl??'',fields:toFormFields(template)});
    setEditingId(template.id);setDetectedFields([]);setError('');
  };
  const detectFields=async()=>{if(!form.pdfUrl)return;setError('');setDetecting(true);
    try{setDetectedFields(await detectAcroFormFields(form.pdfUrl));}
    catch(reason){setError(reason instanceof Error?`Não foi possível ler o PDF: ${reason.message}`:'Não foi possível ler o PDF.');}
    finally{setDetecting(false);}
  };
  const submit=async(event:FormEvent)=>{event.preventDefault();setError('');
    const pdfMapping:Record<string,PdfFieldMapping>={};
    for(const field of form.fields){
      if(field.pdfMode==='ACROFORM'&&field.pdfFieldName.trim())pdfMapping[field.key]={mode:'ACROFORM',fieldName:field.pdfFieldName.trim()};
      else if(field.pdfMode==='OVERLAY'&&field.pdfPage&&field.pdfX!==''&&field.pdfY!=='')pdfMapping[field.key]={mode:'OVERLAY',page:Number(field.pdfPage),x:Number(field.pdfX),y:Number(field.pdfY),...(field.pdfFontSize?{fontSize:Number(field.pdfFontSize)}:{})};
    }
    const payload={
      name:form.name,description:form.description,worldId:form.worldId||null,gameSystemId:form.gameSystemId||null,
      pdfUrl:form.pdfUrl.trim()||null,pdfMapping,
      fields:form.fields.map((field)=>({key:field.key,label:field.label,type:field.type,required:field.required,...(field.type==='CHOICE'?{options:field.optionsText.split(',').map((option)=>option.trim()).filter(Boolean)}:{})})),
    };
    try{
      if(editingId)await patchJson(`/sheets/templates/${editingId}`,payload);
      else await postJson('/sheets/templates',payload);
      resetForm();resource.reload();
    }catch(reason){setError(reason instanceof Error?reason.message:`Não foi possível ${editingId?'salvar':'criar'} o modelo.`);}
  };
  const remove=async(templateId:string)=>{setError('');
    try{await deleteApi(`/sheets/templates/${templateId}`);if(editingId===templateId)resetForm();resource.reload();}
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
            <span><strong>{template.name}</strong><small>{template.gameSystemName??template.worldName??'Global'} · {template.fields.length} campos · v{template.version}{template.pdfUrl?' · PDF vinculado':''}{template.description?` · ${template.description}`:''}</small></span>
            <div className="button-row">
              <button type="button" className="ghost-button" onClick={()=>editTemplate(template)}>Editar</button>
              <button type="button" className="ghost-button" onClick={()=>void remove(template.id)}><Trash2 size={16}/>Excluir</button>
            </div>
          </li>)}</ul>:<Empty title="Nenhum modelo criado" text="Crie o primeiro modelo de ficha para vincular a Personagens e NPCs." action="Ver Vault" to="/app/vault"/>}
        </section>
      </div>
      <form className="panel template-form" onSubmit={submit}>
        <h2>{editingId?'Editar modelo':'Novo modelo'}</h2>
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
            {field.type==='CHOICE'&&<label className="span-full">Opções (separadas por vírgula)<input required maxLength={800} placeholder="ex: Cauteloso, Ousado" value={field.optionsText} onChange={(event)=>updateField(index,{optionsText:event.target.value})}/></label>}
            <label className="checkbox-row"><input type="checkbox" checked={field.required} onChange={(event)=>updateField(index,{required:event.target.checked})}/>Obrigatório</label>
            {form.pdfUrl&&<div className="pdf-field-mapping">
              <label>Mapeamento no PDF<select value={field.pdfMode} onChange={(event)=>updateField(index,{pdfMode:event.target.value as TemplateFormField['pdfMode']})}><option value="">Nenhum</option><option value="ACROFORM">Campo de formulário (AcroForm)</option><option value="OVERLAY">Posição no texto (página/x/y)</option></select></label>
              {field.pdfMode==='ACROFORM'&&<label>Nome do campo no PDF<input list="detected-pdf-fields" maxLength={120} value={field.pdfFieldName} onChange={(event)=>updateField(index,{pdfFieldName:event.target.value})}/></label>}
              {field.pdfMode==='OVERLAY'&&<><label>Página<input type="number" min="1" value={field.pdfPage} onChange={(event)=>updateField(index,{pdfPage:event.target.value})}/></label><label>X<input type="number" value={field.pdfX} onChange={(event)=>updateField(index,{pdfX:event.target.value})}/></label><label>Y<input type="number" value={field.pdfY} onChange={(event)=>updateField(index,{pdfY:event.target.value})}/></label><label>Tamanho da fonte<input type="number" min="4" max="72" value={field.pdfFontSize} onChange={(event)=>updateField(index,{pdfFontSize:event.target.value})}/></label></>}
            </div>}
            <button type="button" className="icon-button" aria-label={`Remover campo ${index+1}`} disabled={form.fields.length===1} onClick={()=>setForm((current)=>({...current,fields:current.fields.filter((_,fieldIndex)=>fieldIndex!==index)}))}><Trash2 size={17}/></button>
          </div>)}
        </div>
        <button type="button" className="ghost-button" onClick={()=>setForm((current)=>({...current,fields:[...current.fields,emptyField()]}))}><Plus size={17}/>Adicionar campo</button>
        <fieldset className="pdf-fieldset">
          <legend>PDF (opcional)</legend>
          <p className="section-note">O PDF nunca é enviado nem armazenado pelo RPG Manager — só a URL e o mapeamento dos campos são guardados. Use apenas PDFs que você tem direito de usar/linkar.</p>
          <label>URL do PDF (https)<input type="url" maxLength={2048} placeholder="https://..." value={form.pdfUrl} onChange={(event)=>setForm({...form,pdfUrl:event.target.value})}/></label>
          {form.pdfUrl&&<button type="button" className="ghost-button" disabled={detecting} onClick={()=>void detectFields()}>{detecting?'Lendo PDF…':'Detectar campos do PDF'}</button>}
          {detectedFields.length>0&&<p className="section-note">{detectedFields.length} campo(s) detectado(s) — sugeridos ao digitar o nome do campo acima.</p>}
          <datalist id="detected-pdf-fields">{detectedFields.map((name)=><option key={name} value={name}/>)}</datalist>
        </fieldset>
        {error&&<p className="form-error">{error}</p>}
        <div className="form-actions">
          {editingId&&<button type="button" className="ghost-button" onClick={resetForm}>Cancelar edição</button>}
          <button className="primary-button">{editingId?'Salvar modelo':'Criar modelo'}</button>
        </div>
      </form>
    </section>
  </div>;
}
