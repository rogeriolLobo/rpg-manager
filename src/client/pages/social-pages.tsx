import { Ban, Bell, Check, Search, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, deleteApi, postJson } from "../api/client";
import { useResource } from "../api/use-resource";
import { ResourceFallback } from "../components/resource-state";
import { Empty, PageHeader } from "./dashboard-page";

// F-016/F-019 (BATCH7): amizades, bloqueios, notificações. Busca reaproveita
// GET /directory/users (já existe, nunca expõe e-mail) — o status de cada
// resultado (amigo/pendente/bloqueado) é calculado aqui no cliente cruzando
// com as listas já carregadas, em vez de anotar o endpoint compartilhado
// com Grupos/Worlds. Ver src/server/routes/social.ts.

interface Person { id: string; userId: string; displayName: string; createdAt: string }
interface SocialData { friends: Person[]; received: Person[]; sent: Person[]; blocks: Person[] }
interface DirectoryUser { id: string; displayName: string }

function socialFetcher(): Promise<SocialData> {
  return Promise.all([
    api<{ items: Person[] }>("/social/friends"),
    api<{ received: Person[]; sent: Person[] }>("/social/requests"),
    api<{ items: Person[] }>("/social/blocks"),
  ]).then(([friends, requests, blocks]) => ({ friends: friends.items, received: requests.received, sent: requests.sent, blocks: blocks.items }));
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

interface Notification { id: string; kind: "FRIEND_REQUEST_RECEIVED" | "FRIEND_REQUEST_ACCEPTED"; payload: { userId: string }; readAt: string | null; createdAt: string }

export function NotificationsButton() {
  const resource = useResource<{ items: Notification[] }>("/social/notifications");
  const [open, setOpen] = useState(false);
  if (resource.status !== "success") return null;
  const items = resource.data.items;
  const unread = items.filter((item) => !item.readAt).length;
  const markAllRead = async () => { await postJson("/social/notifications/read-all", {}); resource.reload(); };
  const label = (item: Notification) => item.kind === "FRIEND_REQUEST_RECEIVED" ? "Novo pedido de amizade" : "Pedido de amizade aceito";
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
              {items.slice(0, 10).map((item) => (
                <li key={item.id} className={item.readAt ? "" : "unread"}>
                  {item.kind === "FRIEND_REQUEST_RECEIVED" ? <UserPlus size={15} /> : <UserCheck size={15} />}<span>{label(item)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
