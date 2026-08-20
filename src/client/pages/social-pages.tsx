import { Ban, Bell, BookOpen, Check, Heart, Search, UserCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, deleteApi, postJson } from "../api/client";
import { useResource } from "../api/use-resource";
import { ResourceFallback } from "../components/resource-state";
import { Empty, PageHeader } from "./dashboard-page";

// F-016/F-019 (BATCH7) + F-017/F-018 (BATCH8): amizades, bloqueios, notificações,
// Biblioteca social e convites de Grupo/Campanha. Busca reaproveita GET
// /directory/users (já existe, nunca expõe e-mail) — o status de cada resultado
// (amigo/pendente/bloqueado) é calculado aqui no cliente cruzando com as listas
// já carregadas, em vez de anotar o endpoint compartilhado com Grupos/Worlds. Ver
// src/server/routes/social.ts.

interface Person { id: string; userId: string; displayName: string; createdAt: string }
interface Invite { id: string; targetType: "GROUP" | "CAMPAIGN"; targetId: string; role: "PLAYER" | "GM"; createdAt: string }
interface ReceivedInvite extends Invite { inviterUserId: string; inviterName: string }
interface SentInvite extends Invite { inviteeUserId: string; inviteeName: string }
interface SocialData { friends: Person[]; received: Person[]; sent: Person[]; blocks: Person[]; invitesReceived: ReceivedInvite[]; invitesSent: SentInvite[] }
interface DirectoryUser { id: string; displayName: string }

function socialFetcher(): Promise<SocialData> {
  return Promise.all([
    api<{ items: Person[] }>("/social/friends"),
    api<{ received: Person[]; sent: Person[] }>("/social/requests"),
    api<{ items: Person[] }>("/social/blocks"),
    api<{ received: ReceivedInvite[]; sent: SentInvite[] }>("/social/invites"),
  ]).then(([friends, requests, blocks, invites]) => ({
    friends: friends.items, received: requests.received, sent: requests.sent, blocks: blocks.items,
    invitesReceived: invites.received, invitesSent: invites.sent,
  }));
}

export function FriendsPage() {
  const resource = useResource<SocialData>("/social", socialFetcher);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>();
  const [searchError, setSearchError] = useState("");
  const [actionError, setActionError] = useState("");

  if (resource.status !== "success") return <ResourceFallback state={resource} onRetry={resource.reload} />;
  const data = resource.data;

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setSearchError("");
    try {
      const result = await api<{ items: DirectoryUser[] }>(`/directory/users?q=${encodeURIComponent(query)}`);
      setResults(result.items);
    } catch (reason) {
      setSearchError(reason instanceof Error ? reason.message : "Não foi possível buscar contas.");
    }
  };

  const act = async (action: () => Promise<unknown>) => {
    setActionError("");
    try {
      await action();
      resource.reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Não foi possível concluir a ação.");
    }
  };

  const sendRequest = (userId: string) => act(() => postJson("/social/requests", { targetUserId: userId }));
  const acceptRequest = (id: string) => act(() => postJson(`/social/requests/${id}/accept`, {}));
  const declineRequest = (id: string) => act(() => postJson(`/social/requests/${id}/decline`, {}));
  const cancelRequest = (id: string) => act(() => deleteApi(`/social/requests/${id}`));
  const removeFriend = (userId: string) => { if (confirm("Remover esta amizade?")) void act(() => deleteApi(`/social/friends/${userId}`)); };
  const blockUser = (userId: string) => { if (confirm("Bloquear esta conta? Isso remove qualquer amizade/pedido existente.")) void act(() => postJson("/social/blocks", { targetUserId: userId })); };
  const unblockUser = (userId: string) => act(() => deleteApi(`/social/blocks/${userId}`));
  const acceptInvite = (id: string) => act(() => postJson(`/social/invites/${id}/accept`, {}));
  const declineInvite = (id: string) => act(() => postJson(`/social/invites/${id}/decline`, {}));
  const cancelInvite = (id: string) => act(() => deleteApi(`/social/invites/${id}`));

  const statusFor = (userId: string) => ({
    friend: data.friends.find((p) => p.userId === userId),
    received: data.received.find((p) => p.userId === userId),
    sent: data.sent.find((p) => p.userId === userId),
    blocked: data.blocks.find((p) => p.userId === userId),
  });

  return (
    <div className="page">
      <PageHeader eyebrow="Social" title="Amigos" description="Encontre outras contas, envie pedidos de amizade e gerencie bloqueios." />

      <form className="panel form-grid" onSubmit={(event) => void search(event)}>
        <label className="span-2">
          <Search size={17} /> Buscar pessoas
          <input value={query} onChange={(event) => setQuery(event.target.value)} minLength={3} maxLength={254} placeholder="Nome público ou e-mail completo" required />
        </label>
        <div className="form-actions span-2"><button className="secondary-button">Buscar</button></div>
      </form>
      {searchError && <p className="form-error">{searchError}</p>}
      {actionError && <p className="form-error">{actionError}</p>}
      {results && (
        <section className="panel">
          <h2>Resultados</h2>
          {results.length === 0 ? <p>Nenhuma conta encontrada.</p> : (
            <ul className="clean-list">
              {results.map((user) => {
                const status = statusFor(user.id);
                return (
                  <li key={user.id}>
                    <strong>{user.displayName}</strong>
                    <div className="button-row">
                      {status.blocked ? <span className="badge">Bloqueado</span>
                        : status.friend ? <span className="badge">Amigos</span>
                        : status.received ? <>
                            <button type="button" className="secondary-button" onClick={() => void acceptRequest(status.received!.id)}><Check size={16} />Aceitar</button>
                            <button type="button" className="ghost-button" onClick={() => void declineRequest(status.received!.id)}><X size={16} />Recusar</button>
                          </>
                        : status.sent ? <span className="badge">Pedido enviado</span>
                        : <button type="button" className="secondary-button" onClick={() => void sendRequest(user.id)}><UserPlus size={16} />Adicionar</button>}
                      {!status.blocked && !status.friend && <button type="button" className="ghost-button" onClick={() => blockUser(user.id)}><Ban size={16} />Bloquear</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Amigos ({data.friends.length})</h2>
        {data.friends.length === 0 ? <Empty title="Nenhum amigo ainda" text="Busque por nome ou e-mail para enviar o primeiro pedido de amizade." action="Ver Biblioteca" to="/app/library" /> : (
          <ul className="clean-list">
            {data.friends.map((friend) => (
              <li key={friend.userId}>
                <strong>{friend.displayName}</strong>
                <div className="button-row">
                  <Link className="ghost-button link-button" to={`/app/friends/${friend.userId}/library`}><BookOpen size={16} />Ver biblioteca</Link>
                  <button type="button" className="ghost-button" onClick={() => removeFriend(friend.userId)}><UserMinus size={16} />Remover</button>
                  <button type="button" className="ghost-button" onClick={() => blockUser(friend.userId)}><Ban size={16} />Bloquear</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.received.length > 0 && (
        <section className="panel">
          <h2>Pedidos recebidos ({data.received.length})</h2>
          <ul className="clean-list">
            {data.received.map((request) => (
              <li key={request.id}>
                <strong>{request.displayName}</strong>
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => void acceptRequest(request.id)}><Check size={16} />Aceitar</button>
                  <button type="button" className="ghost-button" onClick={() => void declineRequest(request.id)}><X size={16} />Recusar</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.sent.length > 0 && (
        <section className="panel">
          <h2>Pedidos enviados ({data.sent.length})</h2>
          <ul className="clean-list">
            {data.sent.map((request) => (
              <li key={request.id}>
                <strong>{request.displayName}</strong>
                <button type="button" className="ghost-button" onClick={() => void cancelRequest(request.id)}><X size={16} />Cancelar</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.invitesReceived.length > 0 && (
        <section className="panel">
          <h2>Convites de Grupo/Campanha ({data.invitesReceived.length})</h2>
          <ul className="clean-list">
            {data.invitesReceived.map((invite) => (
              <li key={invite.id}>
                <span>
                  <strong>{invite.inviterName}</strong>
                  <small>convidou você para {invite.targetType === "GROUP" ? "um grupo" : "uma campanha"} como {invite.role === "GM" ? "narrador" : "jogador"}</small>
                </span>
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => void acceptInvite(invite.id)}><Check size={16} />Aceitar</button>
                  <button type="button" className="ghost-button" onClick={() => void declineInvite(invite.id)}><X size={16} />Recusar</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.invitesSent.length > 0 && (
        <section className="panel">
          <h2>Convites enviados ({data.invitesSent.length})</h2>
          <ul className="clean-list">
            {data.invitesSent.map((invite) => (
              <li key={invite.id}>
                <span><strong>{invite.inviteeName}</strong><small>convite pendente ({invite.targetType === "GROUP" ? "grupo" : "campanha"})</small></span>
                <button type="button" className="ghost-button" onClick={() => void cancelInvite(invite.id)}><X size={16} />Cancelar</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.blocks.length > 0 && (
        <section className="panel">
          <h2>Bloqueados ({data.blocks.length})</h2>
          <ul className="clean-list">
            {data.blocks.map((blocked) => (
              <li key={blocked.userId}>
                <strong>{blocked.displayName}</strong>
                <button type="button" className="ghost-button" onClick={() => void unblockUser(blocked.userId)}><Ban size={16} />Desbloquear</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type NotificationKind = "FRIEND_REQUEST_RECEIVED" | "FRIEND_REQUEST_ACCEPTED" | "SOCIAL_INVITE_RECEIVED" | "SOCIAL_INVITE_ACCEPTED";
interface Notification { id: string; kind: NotificationKind; payload: { userId: string; targetType?: "GROUP" | "CAMPAIGN" }; readAt: string | null; createdAt: string }

const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  FRIEND_REQUEST_RECEIVED: "Novo pedido de amizade",
  FRIEND_REQUEST_ACCEPTED: "Pedido de amizade aceito",
  SOCIAL_INVITE_RECEIVED: "Novo convite de grupo/campanha",
  SOCIAL_INVITE_ACCEPTED: "Convite aceito",
};
const NOTIFICATION_ICONS: Record<NotificationKind, typeof UserPlus> = {
  FRIEND_REQUEST_RECEIVED: UserPlus,
  FRIEND_REQUEST_ACCEPTED: UserCheck,
  SOCIAL_INVITE_RECEIVED: Users,
  SOCIAL_INVITE_ACCEPTED: Check,
};

export function NotificationsButton() {
  const resource = useResource<{ items: Notification[] }>("/social/notifications");
  const [open, setOpen] = useState(false);
  if (resource.status !== "success") return null;
  const items = resource.data.items;
  const unread = items.filter((item) => !item.readAt).length;
  const markAllRead = async () => { await postJson("/social/notifications/read-all", {}); resource.reload(); };
  return (
    <div className="notifications-widget">
      <button type="button" className="icon-button" aria-label={unread > 0 ? `Notificações (${unread} não ${unread === 1 ? "lida" : "lidas"})` : "Notificações"} onClick={() => setOpen((current) => !current)}>
        <Bell size={19} />{unread > 0 && <span className="notification-badge">{unread}</span>}
      </button>
      {open && (
        <div className="panel notifications-dropdown" role="dialog" aria-label="Notificações">
          <div className="section-heading">
            <h3>Notificações</h3>
            {unread > 0 && <button type="button" className="ghost-button" onClick={() => void markAllRead()}>Marcar todas como lidas</button>}
          </div>
          {items.length === 0 ? <p>Nenhuma notificação.</p> : (
            <ul className="clean-list">
              {items.slice(0, 10).map((item) => {
                const Icon = NOTIFICATION_ICONS[item.kind];
                return (
                  <li key={item.id} className={item.readAt ? "" : "unread"}>
                    <Icon size={15} /><span>{NOTIFICATION_LABELS[item.kind]}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Convite de amigo para Grupo/Campanha (F-018) ──
// Reaproveitado por GroupDetailPage e CampaignDetailPage — distinto de
// RegisteredUserSearch (que adiciona qualquer conta cadastrada direto, sem
// convite): aqui só amigos aparecem, e vira membro só depois de aceitar.
export function InviteFriendPanel({ targetType, targetId, allowGameMaster = true }: { targetType: "GROUP" | "CAMPAIGN"; targetId: string; allowGameMaster?: boolean }) {
  const resource = useResource<{ items: Person[] }>("/social/friends");
  const [friendId, setFriendId] = useState("");
  const [role, setRole] = useState<"PLAYER" | "GM">("PLAYER");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  if (resource.status !== "success" || resource.data.items.length === 0) return null;
  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setSent(false);
    if (!friendId) return;
    try {
      await postJson("/social/invites", { inviteeUserId: friendId, targetType, targetId, role });
      setFriendId(""); setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar o convite.");
    }
  };
  return (
    <section className="panel">
      <h2><Users size={19} />Convidar amigo</h2>
      <p className="section-note">Só amigos aparecem aqui — a conta precisa aceitar antes de virar membro.</p>
      <form className="inline-form" onSubmit={(event) => void invite(event)}>
        <label>Amigo
          <select value={friendId} onChange={(event) => setFriendId(event.target.value)} required>
            <option value="">Selecione</option>
            {resource.data.items.map((friend) => <option key={friend.userId} value={friend.userId}>{friend.displayName}</option>)}
          </select>
        </label>
        {allowGameMaster && (
          <label>Papel
            <select value={role} onChange={(event) => setRole(event.target.value as "PLAYER" | "GM")}>
              <option value="PLAYER">Jogador</option>
              {/* BATCH23 (Multi-GM): numa Campaign, aceitar como "Narrador" concede acesso real de
                  Co-Mestre (VTT/handouts/sessões) — nunca só o rótulo de exibição que já existia
                  para Grupos. */}
              <option value="GM">{targetType === "CAMPAIGN" ? "Narrador (Co-Mestre — administra a mesa)" : "Narrador"}</option>
            </select>
          </label>
        )}
        <button className="secondary-button"><UserPlus size={16} />Convidar</button>
      </form>
      {sent && <p className="success-message">Convite enviado.</p>}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

// ── Biblioteca social (F-017) ──
interface FriendLibraryItem { id: string; title: string; categoryName: string | null; subgenreName: string | null; readingStatus: string; hasPlayed: boolean; coverUrl: string | null; sharedInterest: boolean; inCommon: boolean }

export function FriendLibraryPage() {
  const { userId } = useParams();
  const resource = useResource<{ owner: { displayName: string }; items: FriendLibraryItem[] }>(userId ? `/social/friends/${userId}/library` : null);
  if (resource.status !== "success") return <ResourceFallback state={resource} onRetry={resource.reload} />;
  const { owner, items } = resource.data;
  return (
    <div className="page">
      <PageHeader eyebrow="Biblioteca de amigo" title={`Biblioteca de ${owner.displayName}`} description="Notas, prioridade, grupo, mestre e data planejada são sempre privados — mesmo aqui." />
      {items.length === 0 ? (
        <Empty title="Nada para mostrar ainda" text={`${owner.displayName} ainda não tem RPGs na Biblioteca.`} action="Ver meus amigos" to="/app/friends" />
      ) : (
        <div className="book-grid">
          {items.map((item) => (
            <article className="panel book-card" key={item.id}>
              <strong>{item.title}</strong>
              <p className="section-note">{[item.categoryName, item.subgenreName].filter(Boolean).join(" · ") || "Sem categoria"}</p>
              <div className="button-row">
                {item.inCommon && <span className="badge">Vocês têm em comum</span>}
                {item.sharedInterest && <span className="badge"><Heart size={13} /> Interesse social</span>}
                {Boolean(item.hasPlayed) && <span className="badge">Já jogou</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
