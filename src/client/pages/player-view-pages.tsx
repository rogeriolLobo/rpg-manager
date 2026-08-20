import { CalendarDays, Shield, Swords } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { Badge, Empty, formatDate, PageHeader } from './dashboard-page';
import { EntitySheetPanel } from './sheet-pages';
import type { VaultEntity } from './vault-pages';

// F-033 (Player View integrada): "Minhas Mesas" — o jogador descobre as campanhas de que
// participa sem depender de link enviado pelo GM (GET /campaigns/mine, F-033). Reaproveita
// domínios já existentes (Vault Entity, Ficha de personagem, VTT ao vivo) em vez de duplicar —
// esta página é só uma superfície orquestradora, mesmo princípio de F-034 (GM View).
interface PlayerCampaignSummary { id:string; name:string; status:string; rpgTitle:string; gameMaster:string; nextSessionDate:string|null; characterName:string; characterEntityId:string|null }

export function PlayerCampaignsPage(){
  const resource=useResource<{items:PlayerCampaignSummary[]}>('/campaigns/mine');
  if(resource.status!=='success')return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const items=resource.data.items;
  return <div className="page">
    <PageHeader eyebrow="Minhas Mesas" title="Minhas Mesas" description="Campanhas onde você é jogador — entre direto, sem precisar de um link do mestre."/>
    {items.length===0
      ?<Empty title="Nenhuma mesa ainda" text="Quando um mestre te adicionar como jogador ativo de uma campanha (via Grupo de Jogo), ela aparece aqui automaticamente." action="Ver Campanhas" to="/app/campaigns"/>
      :<div className="campaign-grid">
        {items.map((item)=><Link key={item.id} to={`/app/my-tables/${item.id}`} className="campaign-card">
          <div>
            <Badge>{item.status}</Badge>
            <span className="eyebrow">{item.rpgTitle}{item.gameMaster?` · Mestre: ${item.gameMaster}`:''}</span>
            <h2>{item.name}</h2>
            {item.characterName&&<p>Personagem: {item.characterName}</p>}
          </div>
          {item.nextSessionDate&&<dl><div><dt>Próxima sessão</dt><dd><CalendarDays size={14}/> {formatDate(item.nextSessionDate)}</dd></div></dl>}
        </Link>)}
      </div>}
  </div>;
}

interface PlayerCampaignHome { id:string; name:string; status:string; rpgTitle:string; gameMaster:string; nextSessionDate:string|null; characterName:string; characterEntityId:string|null; hasActiveScene:boolean }
interface PlayerHandout { id:string; title:string; content:string; externalResourceTitle:string|null }

// Seção 9 da correção de finalização (Handout reveal via realtime): o GM revela/oculta um
// handout via PATCH /adventures/.../handouts/:id, que já notifica o Durable Object da(s)
// Campaign(s) que usam a Adventure (ver adventures.ts). Esta página ainda não abre o WebSocket
// (isso vive hoje só no VttLivePage) — poll leve, pausado quando a aba não está em foco, mesmo
// princípio Zero-Cost já validado/documentado para o realtime de VTT (F-031: polling é uma
// estratégia realtime aceita, não um fallback de segunda classe). Suficiente para o jogador ver
// um handout revelado sem precisar recarregar a página manualmente.
const PLAYER_HOME_POLL_INTERVAL_MS = 8000;

export function PlayerCampaignHomePage(){
  const {id}=useParams();
  const home=useResource<{item:PlayerCampaignHome;handouts:PlayerHandout[]}>(id?`/campaigns/${id}/player-home`:null);
  useEffect(()=>{
    if(!id)return;
    let timer:ReturnType<typeof setInterval>|null=null;
    const start=()=>{if(!timer)timer=setInterval(()=>home.reload(),PLAYER_HOME_POLL_INTERVAL_MS);};
    const stop=()=>{if(timer){clearInterval(timer);timer=null;}};
    const onVisibility=()=>{if(document.visibilityState==='visible')start();else stop();};
    if(document.visibilityState==='visible')start();
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{stop();document.removeEventListener('visibilitychange',onVisibility);};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload já é estável o bastante para este poll (mesmo padrão já usado em VttLivePage)
  },[id]);
  const characterId=home.status==='success'?home.data.item.characterEntityId:null;
  // GET /vault/:id já aplica a mesma barreira de visibility PLAYERS/CAMPAIGN via
  // campaign_entities (authorizedEntity, reaproveitado) — nenhuma autorização nova aqui.
  const character=useResource<{item:VaultEntity}>(characterId?`/vault/${characterId}`:null);

  if(!id)return null;
  if(home.status!=='success')return <ResourceFallback state={home} onRetry={home.reload}/>;
  const campaign=home.data.item;
  return <div className="page">
    <PageHeader eyebrow="Minhas Mesas" title={campaign.name} description={`${campaign.rpgTitle}${campaign.gameMaster?` · Mestre: ${campaign.gameMaster}`:''}`}
      action={<div className="button-row"><Badge>{campaign.status}</Badge>{campaign.nextSessionDate&&<Badge>{formatDate(campaign.nextSessionDate)}</Badge>}</div>}/>

    <section className="panel">
      <h2><Swords size={20}/>Mesa Virtual</h2>
      {campaign.hasActiveScene
        ?<p>O mestre já ativou uma cena. <Link className="secondary-button link-button" to={`/app/campaigns/${id}/vtt/live`}>Entrar na mesa</Link></p>
        :<p className="section-note">O mestre ainda não ativou nenhuma cena para esta mesa.</p>}
    </section>

    <section className="panel">
      <h2><Shield size={20}/>Meu Personagem</h2>
      {!campaign.characterEntityId&&<p className="section-note">O mestre ainda não vinculou seu personagem a esta campanha.</p>}
      {campaign.characterEntityId&&character.status==='success'&&<div>
        <h3>{character.data.item.name}</h3>
        {character.data.item.summary&&<p>{character.data.item.summary}</p>}
        {character.data.item.character&&<dl>
          {character.data.item.character.pronouns&&<div><dt>Pronomes</dt><dd>{character.data.item.character.pronouns}</dd></div>}
          {character.data.item.character.concept&&<div><dt>Conceito</dt><dd>{character.data.item.character.concept}</dd></div>}
          {character.data.item.character.status&&<div><dt>Status</dt><dd>{character.data.item.character.status}</dd></div>}
          {character.data.item.character.notes&&<div><dt>Notas</dt><dd>{character.data.item.character.notes}</dd></div>}
        </dl>}
        {character.data.item.description&&<p>{character.data.item.description}</p>}
        <EntitySheetPanel entityId={campaign.characterEntityId} entityType="CHARACTER" canEdit={false}/>
      </div>}
      {campaign.characterEntityId&&character.status==='loading'&&<p>Carregando personagem…</p>}
    </section>

    <section className="panel">
      <h2>Handouts</h2>
      {home.data.handouts.length===0
        ?<p className="section-note">Nenhum handout revelado ainda.</p>
        :<ul className="clean-list">{home.data.handouts.map((handout)=><li key={handout.id}>
          <strong>{handout.title}</strong>
          {handout.content&&<p>{handout.content}</p>}
          {handout.externalResourceTitle&&<p className="section-note">Recurso: {handout.externalResourceTitle}</p>}
        </li>)}</ul>}
    </section>
  </div>;
}
