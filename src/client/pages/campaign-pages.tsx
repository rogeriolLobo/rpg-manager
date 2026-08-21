import { BookOpen, CalendarPlus, History, Map, Plus, Save, ScrollText, Swords, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, deleteApi, patchJson, postJson } from "../api/client";
import { useResource } from "../api/use-resource";
import { ResourceFallback } from "../components/resource-state";
import type { Rpg } from "./library-pages";
import {
  Badge,
  Empty,
  formatDate,
  Loading,
  PageHeader,
} from "./dashboard-page";
import { displayLabel } from "../labels";
import { InviteFriendPanel } from "./social-pages";

interface Campaign {
  id: string;
  // BATCH23 (Multi-GM): Owner vs Co-GM — só para decidir o que mostrar (excluir campanha,
  // revogar Co-GM); a autorização de verdade é sempre no servidor.
  isOwner: boolean;
  rpgId: string;
  rpgTitle: string;
  // LIB-006: indicador para a Campaign continuar funcionando/mostrando o RPG mesmo depois de
  // arquivado (nunca quebra a Campaign — ver docs/library/LIBRARY_ARCHIVE.md).
  rpgArchived: boolean;
  name: string;
  status: string;
  sessionMode: string;
  gameMaster: string;
  sessionZeroDate: string | null;
  firstSessionDate: string | null;
  frequency: string | null;
  nextSessionDate: string | null;
  lastSessionDate: string | null;
  sessionGoal: number | null;
  playGroupId: string | null;
  playGroupName: string | null;
  adventureEntityId: string | null;
  adventureName: string | null;
  legacyMembersText: string;
  legacyCharactersText: string;
  notes: string;
  sessionsCompleted: number;
  progress: number | null;
  stage: string;
  nextAction: string;
}
interface Member {
  id: string;
  playerName: string;
  characterName: string;
  characterEntityId: string | null;
  notes: string;
  active: number;
  linkedUserId?: string | null;
  isGameMaster?: number;
}
interface GameSession {
  id: string;
  sessionNumber: number;
  title: string;
  playedAt: string;
  summary: string;
  gmNotes: string;
  nextHooks: string;
}
interface PlayGroup { id:string; name:string; gameMasterName?:string|null }
interface CampaignEntity { id:string;entityType:string;name:string;summary:string;visibility:string;usageType:string }
interface AdventureOption { id:string;name:string }
export function CampaignsPage() {
  const [search] = useSearchParams(); const worldId = search.get('worldId');
  const resource = useResource<{ items: Campaign[] }>(`/campaigns${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ''}`);
  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const items = resource.data.items;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Campanhas"
        title="Planejador de mesas"
        description="Da Sessão Zero ao último capítulo, com a próxima ação sempre à vista."
        action={
          <div className="button-row">
            {/* F-024: One-Shot é um Formato dentro do mesmo formulário de campanha (nunca um
                domínio separado) — mas sem um atalho visível, ninguém descobria a opção
                (achado real do usuário: "não conseguimos criar OneShot"). Query param
                pré-seleciona o Formato, mesmo padrão já usado por worldId/playGroupId. */}
            <Link className="secondary-button link-button" to={`/app/campaigns/new?sessionMode=ONE_SHOT${worldId ? `&worldId=${encodeURIComponent(worldId)}` : ''}`}>
              <Plus size={18} />
              Nova mesa única
            </Link>
            <Link className="primary-button link-button" to={`/app/campaigns/new${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ''}`}>
              <Plus size={18} />
              Nova campanha
            </Link>
          </div>
        }
      />
      {items.length === 0 ? (
        <Empty
          title="Nenhuma campanha planejada"
          text="Escolha um RPG da estante e reúna o grupo."
          action="Criar campanha"
          to={`/app/campaigns/new${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ''}`}
        />
      ) : (
        <div className="campaign-grid">
          {items.map((item) => (
            <article className="campaign-card" key={item.id}>
              <Link className="campaign-card-main" to={`/app/campaigns/${item.id}`}>
                <div>
                <Badge>{item.status}</Badge>
                {item.sessionMode === "ONE_SHOT" && <Badge>{item.sessionMode}</Badge>}
                <span className="eyebrow">{item.rpgTitle}{item.rpgArchived && " · RPG arquivado"}</span>
                <h2>{item.name}</h2>
                <p>{item.nextAction}</p>
                </div>
                <dl>
                <div>
                  <dt>Etapa</dt>
                  <dd>{item.stage}</dd>
                </div>
                <div>
                  <dt>Sessões</dt>
                  <dd>{item.sessionsCompleted}</dd>
                </div>
                <div>
                  <dt>Próxima</dt>
                  <dd>{formatDate(item.nextSessionDate)}</dd>
                </div>
                <div>
                  <dt>Progresso</dt>
                  <dd>
                    {item.progress === null ? "Sem meta" : `${item.progress}%`}
                  </dd>
                </div>
                </dl>
              </Link>
              <div className="campaign-card-actions">
                <Link className="ghost-button link-button" to={`/app/campaigns/${item.id}`}>Abrir campanha</Link>
                <Link className="secondary-button link-button" to={`/app/campaigns/${item.id}/vtt`}><Swords size={16}/>Mesa do Mestre</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const blank = {
  rpgId: "",
  name: "",
  status: "PLANNING",
  sessionMode: "CAMPAIGN",
  gameMaster: "",
  sessionZeroDate: "",
  firstSessionDate: "",
  frequency: "",
  nextSessionDate: "",
  sessionGoal: "",
  playGroupId: "",
  adventureEntityId: "",
  legacyMembersText: "",
  legacyCharactersText: "",
  notes: "",
};
export function CampaignFormPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [rpgs, setRpgs] = useState<Rpg[]>([]);
  const [groups, setGroups] = useState<PlayGroup[]>([]);
  const [adventures, setAdventures] = useState<AdventureOption[]>([]);
  const worldId = search.get('worldId');
  const requestedAdventureId = search.get('adventureId');
  const [form, setForm] = useState<Record<string, string>>({
    ...blank,
    rpgId: search.get("rpgId") ?? "",
    playGroupId: search.get("playGroupId") ?? "",
    adventureEntityId: requestedAdventureId ?? "",
    sessionMode: search.get("sessionMode") === "ONE_SHOT" ? "ONE_SHOT" : blank.sessionMode,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  // RPG-1.0-BATCH7: guard `active` evita que a resposta descartável do efeito duplicado pelo
  // React StrictMode (dev only) sobrescreva `form` depois que o usuário já começou a editar
  // (mesmo achado real de VaultFormPage/WorldFormPage, via E2E).
  useEffect(() => {
    let active = true;
    void Promise.all([api<{ items: Rpg[] }>("/rpgs?pageSize=100&sort=title"),api<{items:PlayGroup[]}>("/groups"),api<{items:AdventureOption[]}>(`/vault?type=ADVENTURE&pageSize=50&sort=name${worldId?`&worldId=${encodeURIComponent(worldId)}`:''}`)]).then(([rpgResult,groupResult,adventureResult])=>{if(!active)return;setRpgs(rpgResult.items);setGroups(groupResult.items);setAdventures(adventureResult.items);}).catch(()=>{});
    if (id)
      void api<{ item: Campaign }>(`/campaigns/${id}`).then(({ item }) => {
        if (!active) return;
        setForm({
          rpgId: item.rpgId,
          name: item.name,
          status: item.status,
          sessionMode: item.sessionMode,
          gameMaster: item.gameMaster,
          sessionZeroDate: item.sessionZeroDate ?? "",
          firstSessionDate: item.firstSessionDate ?? "",
          frequency: item.frequency ?? "",
          nextSessionDate: item.nextSessionDate ?? "",
          sessionGoal: item.sessionGoal?.toString() ?? "",
          playGroupId: item.playGroupId ?? "",
          adventureEntityId: requestedAdventureId ?? item.adventureEntityId ?? "",
          legacyMembersText: item.legacyMembersText,
          legacyCharactersText: item.legacyCharactersText,
          notes: item.notes,
        });
        // LIB-006: garante que o RPG já vinculado apareça na lista mesmo se foi arquivado
        // depois da campanha criada (GET /rpgs só lista ativos por padrão) — nunca força
        // o usuário a trocar de RPG só por isso (seção 11 do pedido LIB-006).
        if (item.rpgArchived) {
          void api<{ item: Rpg }>(`/rpgs/${item.rpgId}`).then(({ item: rpg }) => {
            if (active) setRpgs((current) => (current.some((existing) => existing.id === rpg.id) ? current : [...current, rpg]));
          }).catch(()=>{});
        }
      }).catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Não foi possível carregar esta campanha.');})
        .finally(()=>{if(active)setLoading(false);});
    return () => { active = false; };
  }, [id,requestedAdventureId,worldId]);
  const update = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      frequency: form.frequency || null,
      sessionZeroDate: form.sessionZeroDate || null,
      firstSessionDate: form.firstSessionDate || null,
      nextSessionDate: form.nextSessionDate || null,
      sessionGoal: form.sessionGoal ? Number(form.sessionGoal) : null,
      playGroupId: form.playGroupId || null,
      adventureEntityId: form.adventureEntityId || null,
    };
    try {
      const result = id
        ? await patchJson<{ item: Campaign }>(`/campaigns/${id}`, payload)
        : await postJson<{ item: Campaign }>("/campaigns", payload);
      navigate(`/app/campaigns/${result.item.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha inesperada.");
    }
  };
  if (loading) return <Loading/>;
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow={id ? "Editar campanha" : "Nova campanha"}
        title="Prepare a próxima história"
        description="O estágio e a próxima ação serão calculados no domínio."
      />
      <form className="panel form-grid" onSubmit={submit}>
        <label className="span-2">
          RPG
          <select
            value={form.rpgId}
            onChange={(e) => update("rpgId", e.target.value)}
            required
          >
            <option value="">Selecione um RPG</option>
            {rpgs.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title}{item.archivedAt ? " (arquivado)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Nome da campanha
          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="PLANNING">Planejando</option>
            <option value="SESSION_ZERO">Sessão Zero</option>
            <option value="PREPARING">Preparando</option>
            <option value="IN_PROGRESS">Em andamento</option>
            <option value="PAUSED">Pausada</option>
            <option value="COMPLETED">Concluída</option>
          </select>
        </label>
        <label>
          Formato
          <select
            value={form.sessionMode}
            onChange={(e) => update("sessionMode", e.target.value)}
          >
            <option value="CAMPAIGN">Campanha</option>
            <option value="ONE_SHOT">One-Shot (mesa única)</option>
          </select>
        </label>
        <label>
          Narrador
          <input
            value={form.gameMaster}
            onChange={(e) => update("gameMaster", e.target.value)}
          />
        </label>
        <label>
          Sessão Zero
          <input
            type="date"
            value={form.sessionZeroDate}
            onChange={(e) => update("sessionZeroDate", e.target.value)}
          />
        </label>
        <label>
          Primeira sessão
          <input
            type="date"
            value={form.firstSessionDate}
            onChange={(e) => update("firstSessionDate", e.target.value)}
          />
        </label>
        <label>
          Frequência
          <select
            value={form.frequency}
            onChange={(e) => update("frequency", e.target.value)}
          >
            <option value="">Não definida</option>
            <option value="WEEKLY">Semanal</option>
            <option value="BIWEEKLY">Quinzenal</option>
            <option value="MONTHLY">Mensal</option>
            <option value="BIMONTHLY">Bimestral</option>
            <option value="IRREGULAR">Irregular</option>
          </select>
        </label>
        <label>
          Próxima sessão
          <input
            type="date"
            value={form.nextSessionDate}
            onChange={(e) => update("nextSessionDate", e.target.value)}
          />
        </label>
        <label>
          Meta de sessões
          <input
            type="number"
            min="1"
            max="999"
            value={form.sessionGoal}
            onChange={(e) => update("sessionGoal", e.target.value)}
          />
        </label>
        <label>
          Grupo de jogo
          <select value={form.playGroupId} onChange={(e) => {
            const group=groups.find((item)=>item.id===e.target.value);
            setForm((current)=>({...current,playGroupId:e.target.value,gameMaster:current.gameMaster||group?.gameMasterName||''}));
          }}>
            <option value="">Nenhum grupo</option>
            {groups.map((group)=><option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
        </label>
        <label id="campaign-adventure">
          Adventure principal
          <select value={form.adventureEntityId} onChange={(e) => update("adventureEntityId", e.target.value)}>
            <option value="">Nenhuma</option>
            {adventures.map((adventure)=><option value={adventure.id} key={adventure.id}>{adventure.name}</option>)}
          </select>
        </label>
        <label>
          Grupo legado (se ambíguo)
          <input
            value={form.legacyMembersText}
            onChange={(e) => update("legacyMembersText", e.target.value)}
            maxLength={2000}
          />
        </label>
        <label className="span-2">
          Personagens legados (se ambíguos)
          <input value={form.legacyCharactersText} onChange={(e) => update("legacyCharactersText", e.target.value)} maxLength={2000}/>
        </label>
        <label className="span-2">
          Notas
          <textarea
            rows={5}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            maxLength={10000}
          />
        </label>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button
            className="ghost-button"
            type="button"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button className="primary-button">Salvar campanha</button>
        </div>
      </form>
    </div>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const resource = useResource<{
    item: Campaign;
    members: Member[];
    sessions: GameSession[];
    entities: CampaignEntity[];
  }>(id ? `/campaigns/${id}` : null);
  // F-033: opções de "Meu Personagem" (Vault CHARACTER do próprio GM) para o seletor do
  // membro — buscado uma vez aqui, não por linha, para não repetir a chamada por jogador.
  const characterOptions = useResource<{ items: Array<{ id: string; name: string }> }>('/vault?type=CHARACTER&pageSize=100&archive=active');
  const load = async () => { resource.reload(); };
  if (resource.status !== "success") return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const data = resource.data;
  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const playerName = String(form.get("playerName") ?? "");
    const characterName = String(form.get("characterName") ?? "");
    const result = await postJson<{ id: string }>(`/campaigns/${id}/members`, {
      playerName,
      characterName,
      notes: "",
      active: true,
    });
    formElement.reset();
    resource.mutate((current) => ({
      ...current,
      members: [...current.members, {
        id: result.id,
        playerName,
        characterName,
        characterEntityId: null,
        notes: "",
        active: 1,
        linkedUserId: null,
        isGameMaster: 0,
      }],
    }));
  };
  const remove = async () => {
    if (
      confirm(`Excluir a campanha “${data.item.name}” e todas as suas sessões?`)
    ) {
      await deleteApi(`/campaigns/${id}`);
      navigate("/app/campaigns");
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow={data.item.rpgTitle + (data.item.rpgArchived ? " · RPG arquivado" : "")}
        title={data.item.name}
        description={`${data.item.stage} · ${data.item.nextAction}`}
        action={
          <div className="button-row">
            <Link
              className="ghost-button link-button"
              to={`/app/campaigns/${id}/edit`}
            >
              Editar
            </Link>
            <Link
              className="primary-button link-button"
              to={`/app/campaigns/${id}/vtt`}
            >
              <Swords size={17} />
              Mesa do Mestre
            </Link>
            <Link
              className="secondary-button link-button"
              to={`/app/campaigns/${id}/sessions/new`}
            >
              <CalendarPlus size={17} />
              Registrar sessão
            </Link>
          </div>
        }
      />
      <section className="campaign-summary">
        {[
          ["Status", data.item.status],
          ["Formato", displayLabel(data.item.sessionMode)],
          ["Próxima sessão", formatDate(data.item.nextSessionDate)],
          ["Sessões", data.item.sessionsCompleted],
          [
            "Progresso",
            data.item.progress === null ? "Sem meta" : `${data.item.progress}%`,
          ],
          ["Frequência", data.item.frequency ? displayLabel(data.item.frequency) : "Não definida"],
          ["Grupo", data.item.playGroupName ?? "Não definido"],
          ["Narrador", data.item.gameMaster || "Não definido"],
          ["Adventure", data.item.adventureName || "Não definida"],
        ].map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{label === "Grupo" && data.item.playGroupId
              ? <Link to={`/app/groups/${data.item.playGroupId}`}>{value}</Link>
              : label === "Adventure" && data.item.adventureEntityId
              ? <Link to={`/app/vault/${data.item.adventureEntityId}/adventure`}>{value}</Link>
              : value}</strong>
          </article>
        ))}
      </section>
      <section className="campaign-hub" aria-label="Hub da campanha">
        <article className="panel campaign-hub-card">
          <span className="eyebrow">Preparação</span>
          <h2><BookOpen size={20}/>Adventure e conteúdo</h2>
          {data.item.adventureEntityId
            ? <p>Adventure principal: <Link to={`/app/vault/${data.item.adventureEntityId}/adventure`}>{data.item.adventureName}</Link>.</p>
            : <><p>Nenhuma Adventure vinculada.</p><div className="button-row"><Link className="primary-button link-button" to={`/app/vault/new?type=ADVENTURE&campaignId=${id}`}>Criar Adventure</Link><Link className="secondary-button link-button" to={`/app/campaigns/${id}/edit#campaign-adventure`}>Vincular existente</Link></div></>}
          <a href="#campaign-content">Ver conteúdo relacionado e handouts</a>
        </article>
        <article className="panel campaign-hub-card campaign-hub-featured">
          <span className="eyebrow">Mesa</span>
          <h2><Swords size={20}/>Mesa do Mestre</h2>
          <p>VTT · cenas · tokens · fog · combate e iniciativa.</p>
          <div className="button-row"><Link className="primary-button link-button" to={`/app/campaigns/${id}/vtt`}>Abrir Mesa do Mestre</Link><Link className="secondary-button link-button" to={`/app/campaigns/${id}/sessions/new`}>Registrar sessão</Link></div>
        </article>
        <article className="panel campaign-hub-card">
          <span className="eyebrow">Jogadores</span>
          <h2><Users size={20}/>Grupo e personagens</h2>
          <p>Membros, Co-Mestres, personagens vinculados e suas fichas.</p>
          <div className="button-row"><a className="secondary-button link-button" href="#campaign-players">Ver jogadores</a><Link className="ghost-button link-button" to="/app/sheets"><ScrollText size={16}/>Fichas</Link></div>
        </article>
        <article className="panel campaign-hub-card">
          <span className="eyebrow">Histórico e planejamento</span>
          <h2><History size={20}/>Sessões e notas</h2>
          <p>Datas, frequência, progresso, notas e o histórico da campanha.</p>
          <div className="button-row"><a className="secondary-button link-button" href="#campaign-history">Ver histórico</a><a className="ghost-button link-button" href="#campaign-planning">Planejamento</a></div>
        </article>
      </section>
      <div className="dashboard-grid">
        <section className="panel" id="campaign-players">
          <h2>Jogadores e personagens</h2>
          <form className="inline-form" onSubmit={addMember}>
            <input
              name="playerName"
              placeholder="Jogador"
              aria-label="Nome do jogador"
              required
            />
            <input
              name="characterName"
              placeholder="Personagem"
              aria-label="Nome do personagem"
            />
            <button className="secondary-button">
              <UserPlus size={17} />
              Adicionar
            </button>
          </form>
          {data.members.length ? (
            <div className="group-members">
              {data.members.map((member) => (
                <CampaignMemberEditor key={member.id} campaignId={id!} member={member} onUpdated={load} characterOptions={characterOptions.status==='success'?characterOptions.data.items:[]}/>
              ))}
            </div>
          ) : (
            <p>Nenhum jogador cadastrado.</p>
          )}
          {data.item.legacyMembersText && (
            <p className="legacy-note">
              <strong>Texto legado:</strong> {data.item.legacyMembersText}
            </p>
          )}
          {data.item.legacyCharactersText && <p className="legacy-note"><strong>Personagens legados:</strong> {data.item.legacyCharactersText}</p>}
        </section>
        <InviteFriendPanel targetType="CAMPAIGN" targetId={id!}/>
        <CoGmPanel campaignId={id!} isOwner={data.item.isOwner}/>
        <section className="panel" id="campaign-planning">
          <h2>Planejamento</h2>
          <dl className="stacked-dl">
            <div>
              <dt>Sessão Zero</dt>
              <dd>{formatDate(data.item.sessionZeroDate)}</dd>
            </div>
            <div>
              <dt>Primeira sessão</dt>
              <dd>{formatDate(data.item.firstSessionDate)}</dd>
            </div>
            <div>
              <dt>Última sessão</dt>
              <dd>{formatDate(data.item.lastSessionDate)}</dd>
            </div>
            <div>
              <dt>Próxima ação</dt>
              <dd>{data.item.nextAction}</dd>
            </div>
          </dl>
          <p className="pre-wrap">
            {data.item.notes || "Sem notas de planejamento."}
          </p>
        </section>
      </div>
      <section className="panel campaign-links" id="campaign-content">
        <div className="section-heading"><div><h2><Map size={20}/>Conteúdo relacionado</h2><p className="section-note">Adventure, handouts, mapas e referências continuam nos seus módulos de origem; este hub apenas oferece os caminhos.</p></div><Link to="/app/vault">Abrir Vault</Link></div>
        {data.entities.length?<div className="entity-list">{data.entities.map((entity)=><Link key={entity.id} to={`/app/vault/${entity.id}`}><span className="entity-type">{displayLabel(entity.entityType)}</span><div><strong>{entity.name}</strong><p>{entity.summary||`${displayLabel(entity.usageType)} · ${displayLabel(entity.visibility)}`}</p></div></Link>)}</div>:<p>Nenhuma entidade vinculada.</p>}
      </section>
      <section className="panel" id="campaign-history">
        <div className="section-heading">
          <h2>Histórico de sessões</h2>
          <Link to={`/app/campaigns/${id}/sessions/new`}>Registrar sessão</Link>
        </div>
        {data.sessions.length ? (
          <div className="session-list">
            {data.sessions.map((session) => (
              <Link
                key={session.id}
                to={`/app/campaigns/${id}/sessions/${session.id}`}
              >
                <span className="session-number">{session.sessionNumber}</span>
                <div>
                  <strong>
                    {session.title || `Sessão ${session.sessionNumber}`}
                  </strong>
                  <small>{formatDate(session.playedAt)}</small>
                  <p>{session.summary || "Sem resumo."}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p>Nenhuma sessão registrada ainda.</p>
        )}
      </section>
      {data.item.isOwner && (
        <button className="danger-button" onClick={() => void remove()}>
          <Trash2 size={17} />
          Excluir campanha
        </button>
      )}
    </div>
  );
}

// BATCH23 (Multi-GM, Seção 4 do pedido de finalização): lista de Co-GMs + revogar (Owner-only
// no servidor — authorizeCampaignOwnership; o botão só aparece para o Owner aqui por UX, nunca
// como a barreira real). Conceder acesso continua pelo fluxo já existente de convite social
// (InviteFriendPanel, papel "Narrador (Co-GM)" — aceitar já grava em campaign_co_gms, ver
// src/server/routes/social.ts).
interface CoGm { userId: string; displayName: string; createdAt: string }
function CoGmPanel({ campaignId, isOwner }: { campaignId: string; isOwner: boolean }) {
  const resource = useResource<{ items: CoGm[] }>(`/campaigns/${campaignId}/co-gms`);
  const revoke = async (userId: string) => {
    if (!confirm("Remover o acesso deste Co-GM?")) return;
    await deleteApi(`/campaigns/${campaignId}/co-gms/${userId}`);
    resource.reload();
  };
  if (resource.status !== "success" || resource.data.items.length === 0) return null;
  return (
    <section className="panel">
      <h2>Co-Mestres</h2>
      <p className="section-note">Podem administrar VTT (cenas/tokens/névoa/combate), revelar handouts e conduzir sessões. Nunca podem excluir a campanha nem transferir a posse.</p>
      <ul className="clean-list">
        {resource.data.items.map((coGm) => (
          <li key={coGm.userId}>
            <span>{coGm.displayName}</span>
            {isOwner && (
              <button className="ghost-button" onClick={() => void revoke(coGm.userId)}>
                <Trash2 size={15} />
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CampaignMemberEditor({campaignId,member,onUpdated,characterOptions}:{campaignId:string;member:Member;onUpdated:()=>Promise<void>;characterOptions:Array<{id:string;name:string}>}) {
  const [form,setForm]=useState({playerName:member.playerName,characterName:member.characterName,characterEntityId:member.characterEntityId??'',notes:member.notes,active:Boolean(member.active)}); const [error,setError]=useState('');
  const save=async()=>{setError('');try{await patchJson(`/campaigns/${campaignId}/members/${member.id}`,{...form,characterEntityId:form.characterEntityId||null});await onUpdated();}catch(reason){setError(reason instanceof Error?reason.message:'Falha inesperada.');}};
  return <div className="campaign-member-editor"><label>{member.isGameMaster?'Narrador':'Jogador'}{member.linkedUserId&&<small>Conta cadastrada</small>}<input aria-label={`Jogador ${member.playerName}`} value={form.playerName} disabled={Boolean(member.linkedUserId)} onChange={(event)=>setForm({...form,playerName:event.target.value})}/></label><input aria-label={`Personagem de ${member.playerName}`} placeholder="Personagem" value={form.characterName} onChange={(event)=>setForm({...form,characterName:event.target.value})}/>
    {/* F-033: liga um Vault CHARACTER (ficha/dados estruturados) ao membro — vira "Meu Personagem" na visão do jogador; texto livre acima continua existindo à parte (compatibilidade). */}
    <select aria-label={`Personagem do Vault vinculado a ${member.playerName}`} value={form.characterEntityId} onChange={(event)=>setForm({...form,characterEntityId:event.target.value})}><option value="">Sem ficha vinculada</option>{characterOptions.map((option)=><option key={option.id} value={option.id}>{option.name}</option>)}</select>
    {form.characterEntityId&&<Link className="ghost-button link-button" to={`/app/vault/${form.characterEntityId}`}>Abrir personagem e ficha</Link>}
    <input aria-label={`Notas de ${member.playerName}`} placeholder="Notas" value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})}/><label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event)=>setForm({...form,active:event.target.checked})}/>Ativo</label><button type="button" className="icon-button" aria-label={`Salvar ${member.playerName}`} onClick={()=>void save()}><Save/></button><button type="button" className="icon-button" aria-label={`Excluir ${member.playerName}`} onClick={async()=>{if(confirm('Excluir este membro?')){await deleteApi(`/campaigns/${campaignId}/members/${member.id}`);await onUpdated();}}}><Trash2/></button>{error&&<p className="form-error">{error}</p>}</div>;
}

export function SessionFormPage() {
  const { id, sessionId } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<{ members: Member[] }>();
  const [form, setForm] = useState({
    title: "",
    playedAt: new Date().toISOString().slice(0, 10),
    summary: "",
    gmNotes: "",
    nextHooks: "",
    attendeeMemberIds: [] as string[],
  });
  const [error, setError] = useState("");
  // RPG-1.0-BATCH7: guard `active` evita que a resposta descartável do efeito duplicado pelo
  // React StrictMode (dev only) sobrescreva `form` depois que o usuário já começou a editar.
  useEffect(() => {
    let active = true;
    void api<{ members: Member[] }>(`/campaigns/${id}`).then((result) => { if (active) setCampaign(result); }).catch(()=>{});
    if (sessionId)
      void api<{ item: typeof form }>(
        `/campaigns/${id}/sessions/${sessionId}`,
      ).then(({ item }) => {
        if (active) setForm({ ...item, playedAt: item.playedAt.slice(0, 10) });
      }).catch((reason:unknown)=>{if(active)setError(reason instanceof Error?reason.message:'Não foi possível carregar esta sessão.');});
    return () => { active = false; };
  }, [id, sessionId]);
  const update = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggle = (memberId: string) =>
    setForm((current) => ({
      ...current,
      attendeeMemberIds: current.attendeeMemberIds.includes(memberId)
        ? current.attendeeMemberIds.filter((value) => value !== memberId)
        : [...current.attendeeMemberIds, memberId],
    }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sessionId)
      await patchJson(`/campaigns/${id}/sessions/${sessionId}`, form);
    else await postJson(`/campaigns/${id}/sessions`, form);
    navigate(`/app/campaigns/${id}`);
  };
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow="Diário de campanha"
        title={sessionId ? "Editar sessão" : "Registrar sessão"}
        description="O número e os contadores são calculados no servidor."
      />
      {error && <p className="form-error">{error}</p>}
      <form className="panel form-grid" onSubmit={submit}>
        <label>
          Título
          <input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            maxLength={160}
          />
        </label>
        <label>
          Data jogada
          <input
            type="date"
            value={form.playedAt}
            onChange={(e) => update("playedAt", e.target.value)}
            required
          />
        </label>
        <fieldset className="span-2">
          <legend>Participantes</legend>
          <div className="check-grid">
            {campaign?.members.map((member) => (
              <label className="checkbox" key={member.id}>
                <input
                  type="checkbox"
                  checked={form.attendeeMemberIds.includes(member.id)}
                  onChange={() => toggle(member.id)}
                />
                {member.playerName}
                {member.characterName ? ` — ${member.characterName}` : ""}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="span-2">
          Resumo
          <textarea
            rows={5}
            value={form.summary}
            onChange={(e) => update("summary", e.target.value)}
            maxLength={10000}
          />
        </label>
        <label className="span-2">
          Notas do mestre
          <textarea
            rows={5}
            value={form.gmNotes}
            onChange={(e) => update("gmNotes", e.target.value)}
            maxLength={10000}
          />
        </label>
        <label className="span-2">
          Próximos ganchos
          <textarea
            rows={4}
            value={form.nextHooks}
            onChange={(e) => update("nextHooks", e.target.value)}
            maxLength={5000}
          />
        </label>
        <div className="form-actions span-2">
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button className="primary-button">Salvar sessão</button>
        </div>
      </form>
    </div>
  );
}

export function SessionDetailPage() {
  const { id, sessionId } = useParams();
  const navigate = useNavigate();
  const resource = useResource<{ item: GameSession }>(
    id && sessionId ? `/campaigns/${id}/sessions/${sessionId}` : null,
  );
  if (resource.status !== "success") return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const item = resource.data.item;
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow={`Sessão ${item.sessionNumber}`}
        title={item.title || `Sessão ${item.sessionNumber}`}
        description={formatDate(item.playedAt)}
        action={
          <Link
            className="secondary-button link-button"
            to={`/app/campaigns/${id}/sessions/${sessionId}?edit=1`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/app/campaigns/${id}/sessions/${sessionId}/edit`);
            }}
          >
            Editar
          </Link>
        }
      />
      {[
        ["Resumo", item.summary],
        ["Notas do mestre", item.gmNotes],
        ["Próximos ganchos", item.nextHooks],
      ].map(([title, text]) => (
        <section className="panel prose" key={title}>
          <h2>{title}</h2>
          <p className="pre-wrap">{text || "Nada registrado."}</p>
        </section>
      ))}
      <button
        className="danger-button"
        onClick={async () => {
          if (confirm("Excluir esta sessão?")) {
            await deleteApi(`/campaigns/${id}/sessions/${sessionId}`);
            navigate(`/app/campaigns/${id}`);
          }
        }}
      >
        <Trash2 size={17} />
        Excluir sessão
      </button>
    </div>
  );
}
