import { BookCheck, BookOpen, CalendarDays, Dice5, Library, Lightbulb, ScrollText, Target } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { postJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { displayLabel } from '../labels';
import { useActiveWorld } from '../world/active-world-context';

interface DashboardData { metrics:{total:number;read:number;played:number;wants:number;unread:number;scheduled:number;readingCompletion:number};categories:Array<{name:string;count:number}>;reading:Array<{status:string;count:number}>;recommendations:Array<{id:string;title:string;score:number;priority:string;readingStatus:string;playGroupNotes:string;playGroupName:string;readiness:string;nextAction:string}>;readingBacklog:Array<{id:string;title:string;readingStatus:string;subgenreName:string|null;priority:string}>;activeTables:Array<{id:string;title:string;tableStatus:string;playGroupNotes:string;playGroupName:string;plannedPlayDate:string|null}>;campaigns:Array<{id:string;name:string;rpgTitle:string;status:string;nextSessionDate:string|null;sessionsCompleted:number;progress:number|null;stage:string;nextAction:string;frequency:string|null}> }
const metricIcons=[Library,BookCheck,Dice5,Target,BookOpen,CalendarDays,ScrollText];
export function DashboardPage(){const resource=useResource<DashboardData>('/dashboard');if(resource.status!=='success')return <ResourceFallback state={resource} onRetry={resource.reload}/>;const data=resource.data;const metricEntries=[['Total de RPGs',data.metrics.total],['Já lidos',data.metrics.read],['Já jogados',data.metrics.played],['Quero jogar',data.metrics.wants],['Ainda não lidos',data.metrics.unread],['Mesas agendadas',data.metrics.scheduled],['Leitura concluída',`${data.metrics.readingCompletion}%`]];
  return <div className="page"><PageHeader eyebrow="Visão geral" title="Painel do aventureiro" description="Sua coleção e o caminho mais curto até a próxima mesa." action={<div className="button-row"><QuickIdeaButton/><Link className="primary-button link-button" to="/app/library/new">Adicionar RPG</Link></div>}/><section className="metric-grid">{metricEntries.map(([label,value],index)=>{const Icon=metricIcons[index];return <article className="metric-card" key={label}><Icon/><span>{label}</span><strong>{value}</strong></article>})}</section>
    {data.metrics.total===0?<Empty title="Sua estante ainda está vazia" text="Cadastre o primeiro RPG ou importe o CSV da sua planilha." action="Adicionar primeiro RPG" to="/app/library/new"/>:<>
    <section className="dashboard-grid"><article className="panel"><h2>O que jogar agora?</h2><p className="section-note">Ranking calculado no servidor a partir de interesse, leitura e prontidão.</p><div className="table-wrap"><table><thead><tr><th>Jogo</th><th>Pontos</th><th>Prioridade</th><th>Leitura</th><th>Grupo</th><th>Prontidão</th><th>Próxima ação</th></tr></thead><tbody>{data.recommendations.map(item=><tr key={item.id}><td><Link to={`/app/library/${item.id}`}>{item.title}</Link></td><td><strong>{item.score}</strong></td><td><Badge>{item.priority}</Badge></td><td><Badge>{item.readingStatus}</Badge></td><td>{item.playGroupName||item.playGroupNotes||'—'}</td><td>{item.readiness}</td><td>{item.nextAction}</td></tr>)}</tbody></table></div></article>
    <article className="panel chart-panel"><h2>RPGs por categoria</h2>{data.categories.map(item=><div className="bar-row" key={item.name}><span>{item.name}</span><div><i style={{width:`${Math.max(5,item.count/Math.max(...data.categories.map(x=>x.count))*100)}%`}}/></div><strong>{item.count}</strong></div>)}<h2>Progresso de leitura</h2>{data.reading.map(item=><div className="bar-row" key={item.status}><span>{displayLabel(item.status)}</span><div><i style={{width:`${Math.max(5,item.count/Math.max(...data.reading.map(x=>x.count))*100)}%`}}/></div><strong>{item.count}</strong></div>)}</article></section>
    <section className="dashboard-grid"><article className="panel"><h2>Backlog de leitura</h2>{data.readingBacklog.length?<div className="table-wrap"><table><thead><tr><th>Jogo</th><th>Subgênero</th><th>Prioridade</th></tr></thead><tbody>{data.readingBacklog.map(item=><tr key={item.id}><td><Link to={`/app/library/${item.id}`}>{item.title}</Link></td><td>{item.subgenreName||'—'}</td><td><Badge>{item.priority}</Badge></td></tr>)}</tbody></table></div>:<p>Todas as leituras estão concluídas.</p>}</article><article className="panel"><h2>Mesas em preparação / andamento</h2>{data.activeTables.length?<div className="table-wrap"><table><thead><tr><th>Jogo</th><th>Grupo</th><th>Quando</th><th>Status</th></tr></thead><tbody>{data.activeTables.map(item=><tr key={item.id}><td><Link to={`/app/library/${item.id}`}>{item.title}</Link></td><td>{item.playGroupName||item.playGroupNotes||'—'}</td><td>{formatDate(item.plannedPlayDate)}</td><td><Badge>{item.tableStatus}</Badge></td></tr>)}</tbody></table></div>:<p>Nenhuma mesa ativa agora.</p>}</article></section>
    <section className="panel"><div className="section-heading"><div><h2>Planejador de campanhas</h2><p className="section-note">Etapa e próxima ação derivadas da situação real da campanha.</p></div><Link to="/app/campaigns">Ver todas</Link></div>{data.campaigns.length?<div className="table-wrap"><table><thead><tr><th>RPG</th><th>Campanha</th><th>Status</th><th>Próxima sessão</th><th>Sessões</th><th>Progresso</th><th>Etapa</th><th>Próxima ação</th><th>Frequência</th></tr></thead><tbody>{data.campaigns.map(item=><tr key={item.id}><td>{item.rpgTitle}</td><td><Link to={`/app/campaigns/${item.id}`}>{item.name}</Link></td><td><Badge>{item.status}</Badge></td><td>{formatDate(item.nextSessionDate)}</td><td>{item.sessionsCompleted}</td><td>{item.progress===null?'Sem meta':`${item.progress}%`}</td><td>{item.stage}</td><td>{item.nextAction}</td><td>{displayLabel(item.frequency)}</td></tr>)}</tbody></table></div>:<Empty title="Nenhuma campanha" text="Transforme um RPG da estante na próxima história do grupo." action="Criar campanha" to="/app/campaigns/new"/>}</section></>}</div>}
export function Loading(){return <div className="loading" role="status"><span/>Carregando grimório…</div>}
export function PageHeader({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}){return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>}
export function Badge({children}:{children:React.ReactNode}){return <span className="badge">{displayLabel(String(children))}</span>}
export function Empty({title,text,action,to}:{title:string;text:string;action:string;to:string}){return <div className="empty-state"><Dice5/><h3>{title}</h3><p>{text}</p><Link className="secondary-button link-button" to={to}>{action}</Link></div>}
export function formatDate(value:string|null|undefined){return value?new Intl.DateTimeFormat('pt-BR').format(new Date(`${value.slice(0,10)}T12:00:00`)):'—'}

// F-005 (Ideas/Quick Capture): UX rápida sobre o Diário já existente
// (journal_pages via POST /journal/:worldId/pages, folderId=null) — deliberadamente
// SEM domínio novo (ver docs/product/MASTER_BACKLOG.md). World continua obrigatório
// (journal_pages.world_id é NOT NULL desde a migration 0011; relaxar isso exigiria um
// rebuild de tabela — ver docs/architecture/DATABASE_MIGRATION_SAFETY.md — desproporcional
// para esta feature opcional); por isso o seletor de World abaixo, default no World ativo
// quando o usuário é dono dele. Só aparece para quem já é dono de pelo menos um World —
// sem onde salvar a ideia, o atalho não faz sentido.
function QuickIdeaButton() {
  const { worlds, activeWorld } = useActiveWorld();
  const ownedWorlds = worlds.filter((world) => world.isOwner);
  const [open, setOpen] = useState(false);
  const [worldId, setWorldId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [savedPageId, setSavedPageId] = useState<string | null>(null);

  const openModal = () => {
    setWorldId((activeWorld?.isOwner ? activeWorld.id : ownedWorlds[0]?.id) ?? '');
    setTitle(''); setContent(''); setError(''); setSavedPageId(null);
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!worldId) { setError('Escolha um World.'); return; }
    try {
      const { item } = await postJson<{ item: { id: string } }>(`/journal/${worldId}/pages`, { folderId: null, title, content });
      setSavedPageId(item.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a ideia.');
    }
  };

  if (!ownedWorlds.length) return null;
  return <>
    <button type="button" className="secondary-button" onClick={openModal}><Lightbulb size={18}/>Nova ideia</button>
    {open && <div className="quick-idea-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="panel quick-idea-modal" role="dialog" aria-modal="true" aria-labelledby="quick-idea-heading">
        <h2 id="quick-idea-heading">Nova ideia</h2>
        {savedPageId ? <>
          <p className="success-message">Ideia salva no Diário.</p>
          <div className="button-row">
            <Link className="secondary-button link-button" to={`/app/worlds/${worldId}/journal`} onClick={() => setOpen(false)}>Ver no Diário</Link>
            <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Fechar</button>
          </div>
        </> : <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <label className="span-2">World
            <select value={worldId} onChange={(event) => setWorldId(event.target.value)} required>
              {ownedWorlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}
            </select>
          </label>
          <label className="span-2">Título
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required autoFocus/>
          </label>
          <label className="span-2">Anotação (opcional)
            <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={100_000} rows={4}/>
          </label>
          {error && <p className="form-error span-2">{error}</p>}
          <div className="form-actions span-2">
            <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="primary-button">Salvar ideia</button>
          </div>
        </form>}
      </div>
    </div>}
  </>;
}
