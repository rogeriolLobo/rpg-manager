import { BookMarked, PawPrint, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { displayLabel } from '../labels';
import { Empty, PageHeader } from './dashboard-page';
import type { VaultEntity } from './vault-pages';

// F-027 (BATCH14): Compendium — view agregada de consulta rápida (Creatures/Items/Lore),
// SEM domínio/tabela nova: reaproveita GET /vault (mesmo endpoint da página Vault), só
// reorganiza a apresentação para consulta durante a mesa. Nenhum dado é duplicado — clicar
// num item leva para a mesma entidade do Vault (edição continua só lá).

interface WorldOption { id:string; name:string }
type CompendiumType = 'CREATURE'|'ITEM'|'LORE';
const SECTIONS: Array<{ type:CompendiumType; label:string; icon:typeof PawPrint }> = [
  { type:'CREATURE', label:'Criaturas', icon:PawPrint },
  { type:'ITEM', label:'Itens', icon:Sparkles },
  { type:'LORE', label:'Lore', icon:BookMarked },
];

function CreatureStatBlock({entity}:{entity:VaultEntity}){
  const block=entity.creature?.statBlock;
  if(!block)return null;
  return <dl className="compendium-stat-block">{block.fields.map((field)=><div key={field.key}><dt>{field.label}</dt><dd>{String(block.values[field.key]??'—')}</dd></div>)}</dl>;
}

export function CompendiumPage(){
  const [worlds,setWorlds]=useState<WorldOption[]>([]);
  const [worldId,setWorldId]=useState('');
  const [search,setSearch]=useState('');
  const [items,setItems]=useState<Record<CompendiumType,VaultEntity[]>>({CREATURE:[],ITEM:[],LORE:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{void api<{worlds:WorldOption[]}>('/vault/metadata').then((result)=>setWorlds(result.worlds)).catch(()=>{});},[]);
  useEffect(()=>{let active=true;
    const query=`pageSize=100&sort=name${worldId?`&worldId=${encodeURIComponent(worldId)}`:''}${search?`&search=${encodeURIComponent(search)}`:''}`;
    Promise.all(SECTIONS.map((section)=>api<{items:VaultEntity[]}>(`/vault?type=${section.type}&${query}`)))
      .then((results)=>{if(!active)return;setItems({CREATURE:results[0].items,ITEM:results[1].items,LORE:results[2].items});})
      .catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Não foi possível carregar o Compendium.');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[worldId,search]);

  const total=items.CREATURE.length+items.ITEM.length+items.LORE.length;
  return <div className="page">
    <PageHeader eyebrow="Compendium" title="Consulta rápida" description="Criaturas, itens e lore num só lugar para a mesa — sem sair do Vault que você já mantém."/>
    <div className="vault-filters panel">
      <label className="search-box"><Search/><input aria-label="Buscar no Compendium" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar por nome"/></label>
      <select aria-label="World" value={worldId} onChange={(event)=>setWorldId(event.target.value)}><option value="">Todos os Worlds</option>{worlds.map((world)=><option key={world.id} value={world.id}>{world.name}</option>)}</select>
    </div>
    {error&&<p className="form-error">{error}</p>}
    {!loading&&total===0&&<Empty title="Nada encontrado ainda" text="Cadastre Criaturas, Itens ou Lore no Vault para vê-los aqui." action="Ir para o Vault" to="/app/vault"/>}
    {SECTIONS.map((section)=>{
      const sectionItems=items[section.type];
      if(!loading&&sectionItems.length===0)return null;
      const Icon=section.icon;
      return <section className="panel" key={section.type}>
        <h2><Icon size={20}/>{section.label} {sectionItems.length>0&&`(${sectionItems.length})`}</h2>
        <div className="compendium-grid">{sectionItems.map((entity)=><Link className="entity-card" to={`/app/vault/${entity.id}`} key={entity.id}>
          <div className="entity-card-heading"><span className="entity-type">{displayLabel(entity.visibility)}</span>{entity.worldName&&<span>{entity.worldName}</span>}</div>
          <h3>{entity.name}</h3>
          {entity.entityType==='CREATURE'&&<p>{entity.creature?.classification||entity.summary||'Sem classificação.'}</p>}
          {entity.entityType==='ITEM'&&<p>{[entity.item?.itemType,entity.item?.rarity].filter(Boolean).map((value)=>displayLabel(value as string)).join(' · ')||entity.summary||'Sem descrição.'}</p>}
          {entity.entityType==='LORE'&&<p>{entity.lore?.loreType?displayLabel(entity.lore.loreType):entity.summary||'Sem resumo.'}</p>}
          {entity.entityType==='CREATURE'&&<CreatureStatBlock entity={entity}/>}
        </Link>)}</div>
      </section>;
    })}
  </div>;
}
