import { BookOpen, Grid2X2, List, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, deleteApi, patchJson, postJson } from "../api/client";
import { Badge, Empty, Loading, PageHeader } from "./dashboard-page";
import { displayLabel } from "../labels";

export interface Rpg {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  subgenreId: string | null;
  subgenreName: string | null;
  readingStatus: string;
  hasPlayed: boolean;
  wantsToPlay: boolean;
  priority: string;
  playGroupNotes: string;
  playGroupId: string | null;
  playGroupName: string | null;
  plannedPlayDate: string | null;
  tableStatus: string;
  gameMaster: string;
  notes: string;
  coverUrl: string | null;
  isbn: string | null;
  coverSourceUrl: string | null;
  coverSourceNote: string | null;
  recommendationScore: number;
  readiness: string;
  nextAction: string;
}
interface Metadata {
  categories: Array<{ id: string; name: string }>;
  subgenres: Array<{ id: string; categoryId: string; name: string }>;
  groups: Array<{ id: string; name: string; gameMasterName?: string | null }>;
}
export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<{
    items: Rpg[];
    pagination: { page: number; pageSize: number; total: number };
  }>();
  const [metadata, setMetadata] = useState<Metadata>();
  const [view, setView] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const query = params.toString();
  useEffect(() => {
    void Promise.all([
      api<{ items: Rpg[]; pagination: { page: number; pageSize: number; total: number } }>(`/rpgs?${query}`),
      api<Metadata>("/rpgs/metadata"),
    ]).then(([data, meta]) => {
      setResult(data);
      setMetadata(meta);
    });
  }, [query]);
  const set = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }, [params, setParams]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (search !== (params.get("search") ?? "")) set("search", search);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search, params, set]);
  const selectedCategory = params.get("category") ?? "";
  const totalPages = result
    ? Math.max(1, Math.ceil(result.pagination.total / result.pagination.pageSize))
    : 1;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Biblioteca"
        title="Seu catálogo de RPGs"
        description={`${result?.pagination.total ?? 0} títulos organizados para a próxima aventura.`}
        action={
          <Link className="primary-button link-button" to="/app/library/new">
            <Plus size={18} />
            Novo RPG
          </Link>
        }
      />
      <section className="filters">
        <label className="search-box">
          <Search />
          <input
            aria-label="Buscar por título"
            placeholder="Buscar por título…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Categoria"
          value={params.get("category") ?? ""}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="">Todas as categorias</option>
          {metadata?.categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Subgênero"
          value={params.get("subgenre") ?? ""}
          onChange={(e) => set("subgenre", e.target.value)}
        >
          <option value="">Todos os subgêneros</option>
          {metadata?.subgenres
            .filter((item) => !selectedCategory || item.categoryId === selectedCategory)
            .map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
        </select>
        <select
          aria-label="Leitura"
          value={params.get("readingStatus") ?? ""}
          onChange={(e) => set("readingStatus", e.target.value)}
        >
          <option value="">Toda leitura</option>
          <option value="NOT_STARTED">Não iniciado</option>
          <option value="READING">Lendo</option>
          <option value="READ">Lido</option>
        </select>
        <select aria-label="Já joguei" value={params.get("hasPlayed") ?? ""} onChange={(e) => set("hasPlayed", e.target.value)}>
          <option value="">Jogado ou não</option><option value="true">Já joguei</option><option value="false">Nunca joguei</option>
        </select>
        <select aria-label="Quero jogar" value={params.get("wantsToPlay") ?? ""} onChange={(e) => set("wantsToPlay", e.target.value)}>
          <option value="">Qualquer interesse</option><option value="true">Quero jogar</option><option value="false">Sem marcação</option>
        </select>
        <select aria-label="Prioridade" value={params.get("priority") ?? ""} onChange={(e) => set("priority", e.target.value)}>
          <option value="">Toda prioridade</option><option value="HIGH">Alta</option><option value="MEDIUM">Média</option><option value="LOW">Baixa</option><option value="NONE">Sem prioridade</option>
        </select>
        <select aria-label="Status da mesa" value={params.get("tableStatus") ?? ""} onChange={(e) => set("tableStatus", e.target.value)}>
          <option value="">Toda mesa</option><option value="IDEA">Ideia</option><option value="PREPARING">Preparando</option><option value="SCHEDULED">Agendada</option><option value="PLAYING">Em andamento</option><option value="COMPLETED">Concluída</option>
        </select>
        <select
          aria-label="Ordenação"
          value={params.get("sort") ?? "title"}
          onChange={(e) => set("sort", e.target.value)}
        >
          <option value="title">Título</option>
          <option value="priority">Prioridade</option>
          <option value="readiness">Prontidão</option>
          <option value="recent">Mais recentes</option>
        </select>
        <div className="view-toggle">
          <button
            className={view === "cards" ? "active" : ""}
            onClick={() => setView("cards")}
            aria-label="Cards"
          >
            <Grid2X2 />
          </button>
          <button
            className={view === "table" ? "active" : ""}
            onClick={() => setView("table")}
            aria-label="Tabela"
          >
            <List />
          </button>
        </div>
      </section>
      {!result ? (
        <Loading />
      ) : result.items.length === 0 ? (
        <Empty
          title="Nenhum RPG encontrado"
          text="Ajuste os filtros ou adicione um novo título."
          action="Adicionar RPG"
          to="/app/library/new"
        />
      ) : view === "cards" ? (
        <div className="book-grid">
          {result.items.map((item) => (
            <BookCard item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Título</th>
                <th>Categoria</th>
                <th>Leitura</th>
                <th>Prioridade</th>
                <th>Mesa</th>
                <th>Pontos</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/app/library/${item.id}`}>{item.title}</Link>
                  </td>
                  <td>{item.categoryName ?? "—"}</td>
                  <td>
                    <Badge>{item.readingStatus}</Badge>
                  </td>
                  <td>{displayLabel(item.priority)}</td>
                  <td>{displayLabel(item.tableStatus)}</td>
                  <td>{item.recommendationScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && result.pagination.total > result.pagination.pageSize ? (
        <nav className="pagination" aria-label="Paginação do catálogo">
          <button className="secondary-button" disabled={result.pagination.page <= 1} onClick={() => set("page", String(result.pagination.page - 1))}>Anterior</button>
          <span>Página {result.pagination.page} de {totalPages}</span>
          <button className="secondary-button" disabled={result.pagination.page >= totalPages} onClick={() => set("page", String(result.pagination.page + 1))}>Próxima</button>
        </nav>
      ) : null}
    </div>
  );
}
function BookCard({ item }: { item: Rpg }) {
  return (
    <Link to={`/app/library/${item.id}`} className="book-card">
      <div className="book-cover">
        <CoverImage item={item} />
      </div>
      <div className="book-card-body">
        <Badge>{item.readingStatus}</Badge>
        <h2>{item.title}</h2>
        <p>{item.subgenreName ?? "Sem subgênero"}</p>
        <div className="book-meta">
          <span>
            {displayLabel(item.priority)}
          </span>
          <strong>{item.recommendationScore} pts</strong>
        </div>
      </div>
    </Link>
  );
}

function CoverImage({ item, eager = false }: { item: Rpg; eager?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!item.coverUrl || failedUrl === item.coverUrl) return <><BookOpen /><span>{item.categoryName ?? "RPG"}</span></>;
  return <img
    src={item.coverUrl}
    alt={`Capa de ${item.title}`}
    loading={eager ? "eager" : "lazy"}
    referrerPolicy="no-referrer"
    onError={() => {
      setFailedUrl(item.coverUrl);
      if (import.meta.env.DEV) {
        let host = "inválido";
        try { host = new URL(item.coverUrl!).hostname; } catch { /* URL já validada no servidor. */ }
        console.warn("Falha ao carregar capa de RPG.", { host });
      }
    }}
  />;
}

const initial = {
  title: "",
  categoryId: "",
  subgenreId: "",
  readingStatus: "NOT_STARTED",
  hasPlayed: false,
  wantsToPlay: false,
  priority: "NONE",
  playGroupNotes: "",
  playGroupId: "",
  plannedPlayDate: "",
  tableStatus: "IDEA",
  gameMaster: "",
  notes: "",
  coverUrl: "",
  isbn: "",
  coverSourceUrl: "",
  coverSourceNote: "",
};
export function RpgFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [metadata, setMetadata] = useState<Metadata>();
  const [form, setForm] = useState<Record<string, string | boolean>>(initial);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Metadata>("/rpgs/metadata").then(setMetadata);
    if (id)
      void api<{ item: Rpg }>(`/rpgs/${id}`).then(({ item }) =>
        setForm({
          title: item.title,
          categoryId: item.categoryId ?? "",
          subgenreId: item.subgenreId ?? "",
          readingStatus: item.readingStatus,
          hasPlayed: item.hasPlayed,
          wantsToPlay: item.wantsToPlay,
          priority: item.priority,
          playGroupNotes: item.playGroupNotes,
          playGroupId: item.playGroupId ?? "",
          plannedPlayDate: item.plannedPlayDate ?? "",
          tableStatus: item.tableStatus,
          gameMaster: item.gameMaster,
          notes: item.notes,
          coverUrl: item.coverUrl ?? "",
          isbn: item.isbn ?? "",
          coverSourceUrl: item.coverSourceUrl ?? "",
          coverSourceNote: item.coverSourceNote ?? "",
        }),
      );
  }, [id]);
  const category = String(form.categoryId);
  const subgenres = useMemo(
    () =>
      metadata?.subgenres.filter((item) => item.categoryId === category) ?? [],
    [metadata, category],
  );
  const update = (key: string, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const payload = {
      title: String(form.title),
      categoryId: form.categoryId || null,
      subgenreId: form.subgenreId || null,
      readingStatus: String(form.readingStatus),
      hasPlayed: Boolean(form.hasPlayed),
      wantsToPlay: Boolean(form.wantsToPlay),
      priority: String(form.priority),
      playGroupNotes: String(form.playGroupNotes),
      playGroupId: form.playGroupId || null,
      plannedPlayDate: form.plannedPlayDate || null,
      tableStatus: String(form.tableStatus),
      gameMaster: String(form.gameMaster),
      notes: String(form.notes),
      coverUrl: form.coverUrl || null,
      isbn: form.isbn || null,
      coverSourceUrl: form.coverSourceUrl || null,
      coverSourceNote: form.coverSourceNote || null,
    };
    try {
      const result = id
        ? await patchJson<{ item: Rpg }>(`/rpgs/${id}`, payload)
        : await postJson<{ item: Rpg }>("/rpgs", payload);
      navigate(`/app/library/${result.item.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha inesperada.");
    }
  };
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow={id ? "Editar RPG" : "Novo RPG"}
        title={id ? "Atualize o grimório" : "Adicione à estante"}
        description="Os campos são validados novamente no servidor."
      />
      <form className="panel form-grid" onSubmit={submit}>
        <label className="span-2">
          Título
          <input
            value={String(form.title)}
            onChange={(e) => update("title", e.target.value)}
            maxLength={160}
            required
          />
        </label>
        <label>
          Categoria
          <select
            value={category}
            onChange={(e) => {
              update("categoryId", e.target.value);
              update("subgenreId", "");
            }}
          >
            <option value="">Sem categoria</option>
            {metadata?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subgênero
          <select
            value={String(form.subgenreId)}
            onChange={(e) => update("subgenreId", e.target.value)}
          >
            <option value="">Sem subgênero</option>
            {subgenres.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status da leitura
          <select
            value={String(form.readingStatus)}
            onChange={(e) => update("readingStatus", e.target.value)}
          >
            <option value="NOT_STARTED">Não iniciado</option>
            <option value="READING">Lendo</option>
            <option value="READ">Lido</option>
          </select>
        </label>
        <label>
          Prioridade
          <select
            value={String(form.priority)}
            onChange={(e) => update("priority", e.target.value)}
          >
            <option value="NONE">Nenhuma</option>
            <option value="LOW">Baixa</option>
            <option value="MEDIUM">Média</option>
            <option value="HIGH">Alta</option>
          </select>
        </label>
        <label>
          Status da mesa
          <select
            value={String(form.tableStatus)}
            onChange={(e) => update("tableStatus", e.target.value)}
          >
            <option value="IDEA">Ideia</option>
            <option value="PREPARING">Preparando</option>
            <option value="SCHEDULED">Agendada</option>
            <option value="PLAYING">Jogando</option>
            <option value="COMPLETED">Concluída</option>
          </select>
        </label>
        <label>
          Quando jogar
          <input
            type="date"
            value={String(form.plannedPlayDate)}
            onChange={(e) => update("plannedPlayDate", e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(form.hasPlayed)}
            onChange={(e) => update("hasPlayed", e.target.checked)}
          />
          Já joguei
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={Boolean(form.wantsToPlay)}
            onChange={(e) => update("wantsToPlay", e.target.checked)}
          />
          Quero jogar
        </label>
        <label>
          Grupo de jogo
          <select value={String(form.playGroupId)} onChange={(e) => {
            const group=metadata?.groups.find((item)=>item.id===e.target.value);
            setForm((current)=>({...current,playGroupId:e.target.value,gameMaster:String(current.gameMaster)||group?.gameMasterName||''}));
          }}>
            <option value="">Nenhum grupo cadastrado</option>
            {metadata?.groups.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          Grupo / jogadores (texto legado)
          <input
            value={String(form.playGroupNotes)}
            onChange={(e) => update("playGroupNotes", e.target.value)}
            maxLength={1000}
          />
        </label>
        <label>
          Narrador
          <input
            value={String(form.gameMaster)}
            onChange={(e) => update("gameMaster", e.target.value)}
            maxLength={100}
          />
        </label>
        <label className="span-2">
          URL da capa (opcional)
          <input
            type="url"
            value={String(form.coverUrl)}
            onChange={(e) => update("coverUrl", e.target.value)}
          />
        </label>
        <label>
          ISBN (opcional)
          <input value={String(form.isbn)} onChange={(e) => update("isbn", e.target.value)} maxLength={32} />
        </label>
        <label>
          Fonte da capa (opcional)
          <input type="url" value={String(form.coverSourceUrl)} onChange={(e) => update("coverSourceUrl", e.target.value)} maxLength={1000} />
        </label>
        <label className="span-2">
          Nota da capa (opcional)
          <input value={String(form.coverSourceNote)} onChange={(e) => update("coverSourceNote", e.target.value)} maxLength={1000} />
        </label>
        <label className="span-2">
          Notas
          <textarea
            value={String(form.notes)}
            onChange={(e) => update("notes", e.target.value)}
            maxLength={10000}
            rows={5}
          />
        </label>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button className="primary-button">Salvar RPG</button>
        </div>
      </form>
    </div>
  );
}

export function RpgDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{
    item: Rpg;
    campaigns: Array<{ id: string; name: string; status: string }>;
  }>();
  useEffect(() => {
    void api<{
      item: Rpg;
      campaigns: Array<{ id: string; name: string; status: string }>;
    }>(`/rpgs/${id}`).then(setData);
  }, [id]);
  if (!data) return <Loading />;
  const { item } = data;
  const remove = async () => {
    if (confirm(`Excluir “${item.title}”? Esta ação não pode ser desfeita.`)) {
      await deleteApi(`/rpgs/${item.id}`);
      navigate("/app/library");
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow={item.categoryName ?? "RPG"}
        title={item.title}
        description={`${item.subgenreName ?? "Sem subgênero"} · ${item.readiness}`}
        action={
          <div className="button-row">
            <Link
              className="secondary-button link-button"
              to={`/app/library/${item.id}/edit`}
            >
              Editar
            </Link>
            <Link
              className="primary-button link-button"
              to={`/app/campaigns/new?rpgId=${item.id}`}
            >
              Criar campanha
            </Link>
          </div>
        }
      />
      <div className="detail-grid">
        <aside className="panel detail-cover">
          <div className="book-cover large">
            <CoverImage item={item} eager />
          </div>
          <strong>{item.recommendationScore} pontos</strong>
          <span>{item.nextAction}</span>
        </aside>
        <section className="panel detail-info">
          <h2>Visão geral</h2>
          <dl>
            <div>
              <dt>Leitura</dt>
              <dd>
                <Badge>{item.readingStatus}</Badge>
              </dd>
            </div>
            <div>
              <dt>Prioridade</dt>
              <dd>{displayLabel(item.priority)}</dd>
            </div>
            <div>
              <dt>Já jogou</dt>
              <dd>{item.hasPlayed ? "Sim" : "Não"}</dd>
            </div>
            <div>
              <dt>Quer jogar</dt>
              <dd>{item.wantsToPlay ? "Sim" : "Não"}</dd>
            </div>
            <div>
              <dt>Grupo</dt>
              <dd>{item.playGroupName || item.playGroupNotes || "Não definido"}</dd>
            </div>
            <div>
              <dt>Narrador</dt>
              <dd>{item.gameMaster || "Não definido"}</dd>
            </div>
            <div>
              <dt>Mesa</dt>
              <dd>{displayLabel(item.tableStatus)}</dd>
            </div>
            {item.isbn ? <div><dt>ISBN</dt><dd>{item.isbn}</dd></div> : null}
            {item.coverSourceUrl ? <div><dt>Fonte da capa</dt><dd><a href={item.coverSourceUrl} target="_blank" rel="noreferrer">Abrir fonte</a></dd></div> : null}
          </dl>
          {item.coverSourceNote ? <p className="section-note">{item.coverSourceNote}</p> : null}
          <h2>Notas</h2>
          <p className="pre-wrap">{item.notes || "Nenhuma nota."}</p>
          <h2>Campanhas</h2>
          {data.campaigns.length ? (
            <ul className="clean-list">
              {data.campaigns.map((campaign) => (
                <li key={campaign.id}>
                  <Link to={`/app/campaigns/${campaign.id}`}>
                    {campaign.name}
                  </Link>
                  <Badge>{campaign.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhuma campanha ligada a este RPG.</p>
          )}
          <button className="danger-button" onClick={() => void remove()}>
            <Trash2 size={17} />
            Excluir RPG
          </button>
        </section>
      </div>
    </div>
  );
}
