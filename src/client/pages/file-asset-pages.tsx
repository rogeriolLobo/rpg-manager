import { FileText, Image, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, deleteApi, ClientApiError } from '../api/client';
import { useResource } from '../api/use-resource';

// F-028 (BATCH15): Files/Handouts/Assets — anexo genérico (imagem/PDF) numa Vault Entity,
// Zero Cost (Workers KV Free) — ver src/server/routes/files.ts. Painel complementar (mesmo
// princípio de EntitySheetPanel/metadata/backlinks): se falhar, não bloqueia a página
// principal.

interface FileAsset { id:string; entityId:string|null; contentType:string; byteLength:number; filename:string; createdAt:string }

function formatBytes(bytes:number):string {
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(0)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

export function EntityFilesPanel({entityId,canEdit}:{entityId:string;canEdit:boolean}){
  const resource=useResource<{items:FileAsset[]}>(`/files?entityId=${entityId}`);
  const [error,setError]=useState('');
  const [uploading,setUploading]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);

  if(resource.status!=='success')return null;
  const items=resource.data.items;

  const upload=async(file:File)=>{setError('');setUploading(true);
    try{
      const formData=new FormData();
      formData.set('file',file,file.name);
      formData.set('entityId',entityId);
      await api('/files',{method:'POST',body:formData});
      resource.reload();
    }catch(reason){setError(reason instanceof ClientApiError?reason.message:reason instanceof Error?reason.message:'Não foi possível enviar o arquivo.');}
    finally{setUploading(false);if(inputRef.current)inputRef.current.value='';}
  };
  const remove=async(id:string)=>{setError('');
    try{await deleteApi(`/files/${id}`);resource.reload();}
    catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível excluir o arquivo.');}
  };

  return <section className="panel">
    <div className="section-heading">
      <div><h2><Paperclip size={20}/>Anexos</h2><p className="section-note">Imagens e PDFs (mapas, handouts digitalizados, referências) — até 5MB cada, guardados só para você.</p></div>
      {canEdit&&<label className="secondary-button link-button">{uploading?'Enviando…':<><Upload size={16}/>Enviar arquivo</>}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={uploading} onChange={(event)=>{const file=event.target.files?.[0];if(file)void upload(file);}} style={{display:'none'}}/></label>}
    </div>
    {items.length?<ul className="clean-list">{items.map((item)=><li key={item.id}>
      <a href={`/api/v1/files/${item.id}/content`} target="_blank" rel="noreferrer">{item.contentType==='application/pdf'?<FileText size={16}/>:<Image size={16}/>}{item.filename||'Sem nome'}</a>
      <span><small>{formatBytes(item.byteLength)}</small>{canEdit&&<button className="ghost-button" aria-label={`Excluir anexo ${item.filename||'sem nome'}`} onClick={()=>void remove(item.id)}><Trash2 size={15}/></button>}</span>
    </li>)}</ul>:<p>Nenhum anexo ainda.</p>}
    {error&&<p className="form-error">{error}</p>}
  </section>;
}
