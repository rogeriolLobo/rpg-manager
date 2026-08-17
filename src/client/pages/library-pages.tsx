import { BookOpen, Grid2X2, List, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, ClientApiError, deleteApi, patchJson, postJson } from "../api/client";
import { MAX_COVER_ASSET_BYTES } from "../../domain/rpg/cover-asset";
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
  // LIB-005: capa por upload (Zero Cost — KV). Quando presente, tem prioridade
  // sobre coverUrl na exibição (ver effectiveCoverSrc abaixo) — coverUrl (URL
  // externa) continua intocado, para não interferir no fluxo já existente.
  coverAssetId: string | null;
  // LIB-004: campos editoriais adicionais + provenance.
  subtitle: string;
  authors: string;
  publisher: string;
  publicationYear: number | null;
  language: string;
  publicationType: string;
  metadataSource: string;
  recommendationScore: number;
  readiness: string;
  nextAction: string;
}
// LIB-004/LIB-004A: resultado de busca (catálogo interno, Open Library ou
// importação por URL) — espelha BookMetadataResult
// (src/domain/rpg/metadata-provider.ts) no formato que a API expõe (achatado
// em JSON).
interface SearchResult {
  source: string; origin: "INTERNAL" | "OPEN_LIBRARY" | "URL_IMPORT"; confidence: "EXACT" | "HIGH" | "MEDIUM" | "LOW";
  workId: string | null; editionId: string | null; internalPublicationId?: string; matchedAlias?: string; sourceUrl: string;
  title: string; subtitle?: string; authors?: string; publisher?: string;
  publicationYear?: number; language?: string; isbn10?: string; isbn13?: string; coverUrl?: string;
}
const ORIGIN_LABELS: Record<SearchResult["origin"], string> = {
  INTERNAL: "Já no catálogo do RPG Manager", OPEN_LIBRARY: "Open Library", URL_IMPORT: "Página importada",
};
const PUBLICATION_TYPE_LABELS: Record<string, string> = {
  CORE_RULEBOOK: "Livro básico", PLAYER_GUIDE: "Guia do jogador", GM_GUIDE: "Guia do mestre",
  SUPPLEMENT: "Suplemento", SETTING: "Cenário", ADVENTURE: "Aventura", ONE_SHOT: "One-shot",
  CAMPAIGN: "Campanha", BESTIARY: "Bestiário", SCREEN: "Tela do mestre", OTHER: "Outro",
};
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

// LIB-005: capa enviada por upload tem prioridade sobre a URL externa — mesmo
// critério de leitura do servidor (present() em rpgs.ts). coverUrl nunca é
// alterado por essa prioridade, só a exibição.
function effectiveCoverSrc(item: Rpg): string | null {
  if (item.coverAssetId) return `/api/v1/media/covers/${item.coverAssetId}`;
  return item.coverUrl;
}

function CoverImage({ item, eager = false }: { item: Rpg; eager?: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = effectiveCoverSrc(item);
  if (!src || failedSrc === src) {
    const initials = item.title.split(/\s+/u).filter(Boolean).slice(0,2).map((word)=>word[0]).join('').toLocaleUpperCase('pt-BR');
    return <div className="cover-placeholder"><BookOpen aria-hidden="true"/><strong aria-hidden="true">{initials||'RPG'}</strong><span>{item.categoryName ?? "RPG"}</span></div>;
  }
  return <img
    src={src}
    alt={`Capa de ${item.title}`}
    loading={eager ? "eager" : "lazy"}
    referrerPolicy="no-referrer"
    onError={() => {
      setFailedSrc(src);
      if (import.meta.env.DEV) {
        let host = "inválido";
        try { host = new URL(src, window.location.origin).hostname; } catch { /* URL já validada no servidor. */ }
        console.warn("Falha ao carregar capa de RPG.", { host });
      }
    }}
  />;
}

// LIB-005: processamento de imagem no navegador antes do upload — decodifica,
// redimensiona (lado maior <= COVER_MAX_DIMENSION) e reexporta como
// WebP/JPEG. O servidor NUNCA confia nisso (valida bytes reais do zero — ver
// rpgs.ts), é só para reduzir o custo de armazenamento/transferência (política
// Zero Cost, KV Free tem 1GB no total).
const COVER_MAX_DIMENSION = 800;
const COVER_ENCODE_QUALITY = 0.85;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function processCoverImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Não foi possível ler essa imagem.");
  }
  try {
    const scale = Math.min(1, COVER_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Não foi possível processar essa imagem neste navegador.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const webp = await canvasToBlob(canvas, "image/webp", COVER_ENCODE_QUALITY);
    const blob = webp ?? (await canvasToBlob(canvas, "image/jpeg", COVER_ENCODE_QUALITY));
    if (!blob) throw new Error("Não foi possível gerar a imagem para envio.");
    if (blob.size > MAX_COVER_ASSET_BYTES) throw new Error("Imagem muito grande mesmo após compactação. Tente uma imagem menor.");
    return blob;
  } finally {
    bitmap.close();
  }
}

// LIB-005: upload/remoção de capa — ação independente do formulário principal
// (não usa coverUrl/rpgUpdateInputSchema), disponível na página de detalhe.
// Preserva a capa por URL externa sem qualquer alteração: enviar uma capa não
// mexe em coverUrl, só some por cima na exibição (ver effectiveCoverSrc).
function CoverUploadControls({ item, onChange }: { item: Rpg; onChange: (next: Rpg) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await processCoverImage(file);
      const formData = new FormData();
      formData.append("cover", blob, "cover");
      const { item: updated } = await api<{ item: Rpg }>(`/rpgs/${item.id}/cover`, { method: "POST", body: formData });
      onChange(updated);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : err instanceof Error ? err.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (!confirm("Remover a capa enviada?")) return;
    setBusy(true);
    setError(null);
    try {
      const { item: updated } = await api<{ item: Rpg }>(`/rpgs/${item.id}/cover`, { method: "DELETE" });
      onChange(updated);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Não foi possível remover a capa.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cover-upload-controls">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        id={`cover-upload-${item.id}`}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="button-row">
        <label htmlFor={`cover-upload-${item.id}`} className="secondary-button link-button" aria-disabled={busy}>
          {busy ? "Enviando…" : item.coverAssetId ? "Trocar capa" : "Enviar capa"}
        </label>
        {item.coverAssetId && (
          <button type="button" className="ghost-button" onClick={remove} disabled={busy}>
            Remover capa
          </button>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// LIB-004: painel de busca externa (Open Library) — estados idle/loading/
// results/no-results/provider-error (seção 25 do pedido). Busca só por ação
// explícita (submit do formulário: botão "Buscar" ou Enter) — nunca a cada
// tecla, evita requests desnecessárias contra um provider público de baixo
// volume (seção 5/9 do pedido).
// LIB-004A: fallback "Importar de uma página oficial" (seção 10 do pedido) —
// mesmo painel, sub-fluxo separado por ter seu próprio estado (URL + erro),
// sempre entrega um único resultado (que ainda passa pelo preview obrigatório
// como qualquer outro).
function UrlImportPanel({ onImported }: { onImported: (result: SearchResult) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [state, setState] = useState<{ status: "idle" } | { status: "loading" } | { status: "error"; message: string }>({ status: "idle" });
  const runImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setState({ status: "loading" });
    try {
      const data = await postJson<{ result: SearchResult }>("/rpgs/import-url", { url: url.trim() });
      onImported(data.result);
    } catch (reason) {
      setState({ status: "error", message: reason instanceof Error ? reason.message : "Não foi possível importar essa página agora." });
    }
  };
  if (!open) {
    return (
      <button type="button" className="ghost-button" onClick={() => setOpen(true)}>
        Não encontrou? Importar de uma página oficial
      </button>
    );
  }
  return (
    <form className="url-import-box" onSubmit={(e) => void runImport(e)}>
      <label>
        URL da página oficial do produto (editora, loja…)
        <input
          type="url"
          aria-label="URL da página oficial do produto"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={2000}
        />
      </label>
      {state.status === "error" && <p className="form-error">{state.message}</p>}
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={state.status === "loading"}>Importar</button>
        <button type="button" className="ghost-button" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

function OnlineSearchPanel({ onSelect, onCancel }: { onSelect: (result: SearchResult) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "results"; results: SearchResult[] }
    | { status: "no-results" }
    | { status: "provider-error"; message: string }
  >({ status: "idle" });
  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setState({ status: "loading" });
    try {
      const data = await api<{ results: SearchResult[] }>(`/rpgs/search-external?q=${encodeURIComponent(query.trim())}`);
      setState(data.results.length ? { status: "results", results: data.results } : { status: "no-results" });
    } catch (reason) {
      setState({ status: "provider-error", message: reason instanceof Error ? reason.message : "Não foi possível consultar a Open Library agora." });
    }
  };
  return (
    <div className="panel online-search">
      <form className="search-box" onSubmit={(e) => void runSearch(e)}>
        <Search />
        <input
          aria-label="Buscar livro por título, ISBN ou autor"
          placeholder="Título, ISBN ou autor…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={200}
        />
        <button className="primary-button" type="submit" disabled={state.status === "loading"}>Buscar</button>
      </form>
      {state.status === "loading" && <Loading />}
      {state.status === "provider-error" && (
        <p className="form-error">{state.message}</p>
      )}
      {state.status === "no-results" && (
        <p className="section-note">Nenhum resultado confiável encontrado. Você pode tentar outros termos, importar de uma página oficial ou cadastrar manualmente.</p>
      )}
      {state.status === "results" && (
        <ul className="search-results-list">
          {state.results.map((result, index) => (
            <li key={`${result.internalPublicationId ?? result.editionId ?? result.workId ?? index}`} className="search-result-item">
              {result.coverUrl ? (
                <img src={result.coverUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
              ) : (
                <div className="cover-placeholder small"><BookOpen aria-hidden="true" /></div>
              )}
              <div className="search-result-info">
                <strong>{result.title}</strong>
                {result.subtitle && <span>{result.subtitle}</span>}
                <span className="search-result-meta">
                  {[result.authors, result.publisher, result.publicationYear].filter(Boolean).join(" · ") || "Sem mais detalhes"}
                </span>
                {(result.isbn13 ?? result.isbn10) && <span className="search-result-meta">ISBN {result.isbn13 ?? result.isbn10}</span>}
                <span className="search-result-meta search-result-origin">
                  {ORIGIN_LABELS[result.origin]}
                  {result.matchedAlias ? ` · encontrado via "${result.matchedAlias}"` : ""}
                </span>
              </div>
              <button type="button" className="secondary-button" onClick={() => onSelect(result)}>Selecionar</button>
            </li>
          ))}
        </ul>
      )}
      <UrlImportPanel onImported={onSelect} />
      <button type="button" className="ghost-button" onClick={onCancel}>Cadastrar manualmente</button>
    </div>
  );
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
  subtitle: "",
  publisher: "",
  publicationYear: "",
  language: "",
  publicationType: "",
  authors: "",
  metadataSource: "",
  metadataSourceId: "",
  metadataSourceUrl: "",
  metadataFetchedAt: "",
  externalWorkId: "",
  externalEditionId: "",
  reusePublicationId: "",
};
export function RpgFormPage() {
  const { id } = useParams();
  // A key força um remount completo sempre que o RPG (ou o modo editar/novo) muda: evita
  // que campos de uma tela anterior — como coverUrl — "vazem" para este RPG e pareçam já
  // persistidos aqui, sem precisar resetar estado manualmente dentro de um efeito.
  return <RpgFormFields key={id ?? "__new__"} id={id} />;
}
function RpgFormFields({ id }: { id?: string }) {
  const navigate = useNavigate();
  const [metadata, setMetadata] = useState<Metadata>();
  const [form, setForm] = useState<Record<string, string | boolean>>(initial);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(Boolean(id));
  // LIB-004: só relevante para cadastro novo — editar um RPG existente nunca reabre busca
  // (o PATCH não reatribui identidade/provenance, ver library-writes.ts). "manual" continua
  // sendo o modo padrão/imediatamente visível: não pode quebrar quem já usa o cadastro manual
  // nem os fluxos E2E existentes que preenchem o formulário direto.
  const [mode, setMode] = useState<"manual" | "search" | "preview">("manual");
  // LIB-004C (seção 19 do pedido): não apresentar um import por URL parcial como se fosse
  // completo. Só relevante para URL_IMPORT — Open Library/catálogo interno já tendem a ser mais
  // ricos e não são o escopo deste ajuste.
  const [sparseImport, setSparseImport] = useState(false);
  useEffect(() => {
    // O guard `active` evita que uma resposta lenta ainda em voo sobrescreva os dados corretos
    // caso o componente seja desmontado (troca de RPG) antes dela chegar.
    let active = true;
    void api<Metadata>("/rpgs/metadata").then((data) => { if (active) setMetadata(data); });
    if (id)
      void api<{ item: Rpg }>(`/rpgs/${id}`).then(({ item }) => {
        if (!active) return;
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
          subtitle: item.subtitle ?? "",
          publisher: item.publisher ?? "",
          publicationYear: item.publicationYear ? String(item.publicationYear) : "",
          language: item.language ?? "",
          publicationType: item.publicationType ?? "",
          authors: item.authors ?? "",
          // Provenance nunca é reeditada no PATCH (ver library-writes.ts) — não precisa
          // ser carregada de volta no formulário, só exibida (RpgDetailPage).
          metadataSource: "", metadataSourceId: "", metadataSourceUrl: "", metadataFetchedAt: "",
          externalWorkId: "", externalEditionId: "", reusePublicationId: "",
        });
        setLoading(false);
      });
    return () => { active = false; };
  }, [id]);
  const category = String(form.categoryId);
  const subgenres = useMemo(
    () =>
      metadata?.subgenres.filter((item) => item.categoryId === category) ?? [],
    [metadata, category],
  );
  const update = (key: string, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  // LIB-004/LIB-004A: seleção de um resultado de busca preenche o MESMO formulário usado pelo
  // cadastro manual — a tela que aparece em seguida (mode="preview") já É a revisão obrigatória
  // antes de salvar: mesmos campos, editáveis, mesmo botão "Salvar RPG". Um resultado INTERNAL
  // (catálogo já conhecido) nunca grava provenance nova — só referencia a Publication existente
  // por ID (reusePublicationId), preservando a origem/histórico real dela.
  const selectSearchResult = (result: SearchResult) => {
    const isInternal = result.origin === "INTERNAL";
    if (result.origin === "URL_IMPORT") {
      const enrichedFieldCount = [result.subtitle, result.authors, result.publisher, result.publicationYear, result.language, result.isbn13 ?? result.isbn10, result.coverUrl].filter(Boolean).length;
      setSparseImport(enrichedFieldCount < 2);
    } else {
      setSparseImport(false);
    }
    setForm((current) => ({
      ...current,
      title: result.title,
      subtitle: result.subtitle ?? "",
      publisher: result.publisher ?? "",
      publicationYear: result.publicationYear ? String(result.publicationYear) : "",
      language: result.language ?? "",
      authors: result.authors ?? "",
      isbn: result.isbn13 ?? result.isbn10 ?? "",
      coverUrl: result.coverUrl ?? "",
      coverSourceUrl: isInternal ? String(current.coverSourceUrl) : result.sourceUrl,
      publicationType: String(current.publicationType) || "CORE_RULEBOOK",
      metadataSource: isInternal ? "" : result.origin,
      metadataSourceId: isInternal ? "" : (result.editionId ?? result.workId ?? ""),
      metadataSourceUrl: isInternal ? "" : result.sourceUrl,
      metadataFetchedAt: isInternal ? "" : new Date().toISOString(),
      externalWorkId: isInternal ? "" : (result.workId ?? ""),
      externalEditionId: isInternal ? "" : (result.editionId ?? ""),
      reusePublicationId: isInternal ? (result.internalPublicationId ?? "") : "",
    }));
    setMode("preview");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    const fromSearch = form.metadataSource === "OPEN_LIBRARY" || form.metadataSource === "URL_IMPORT";
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
      subtitle: form.subtitle || undefined,
      publisher: form.publisher || undefined,
      publicationYear: form.publicationYear ? Number(form.publicationYear) : null,
      language: form.language || undefined,
      publicationType: form.publicationType || undefined,
      authors: form.authors || undefined,
      ...(fromSearch ? {
        metadataSource: form.metadataSource as "OPEN_LIBRARY" | "URL_IMPORT",
        metadataSourceId: form.metadataSourceId || undefined,
        metadataSourceUrl: form.metadataSourceUrl || undefined,
        metadataFetchedAt: form.metadataFetchedAt || undefined,
        externalWorkId: form.externalWorkId || undefined,
        externalEditionId: form.externalEditionId || undefined,
      } : {}),
      // LIB-004A: catálogo interno — reaproveita a Publication existente por ID, sem
      // reescrever provenance (ver buildCreateLibraryEntryStatements).
      ...(form.reusePublicationId ? { reusePublicationId: String(form.reusePublicationId) } : {}),
    };
    try {
      const result = id
        ? await patchJson<{ item: Rpg }>(`/rpgs/${id}`, payload)
        : await postJson<{ item: Rpg }>("/rpgs", payload);
      navigate(`/app/library/${result.item.id}`);
    } catch (reason) {
      if (reason instanceof ClientApiError && reason.fields) {
        setFieldErrors(reason.fields);
        setError("Revise os campos destacados.");
      } else {
        setError(reason instanceof Error ? reason.message : "Falha inesperada.");
      }
    }
  };
  const fieldError = (name: string) => fieldErrors[name]?.[0];
  if (!id && mode === "search") {
    return (
      <div className="page narrow">
        <PageHeader eyebrow="Novo RPG" title="Buscar publicação" description="Catálogo do RPG Manager, Open Library e páginas oficiais — poucos resultados, você escolhe e revisa antes de salvar." />
        <OnlineSearchPanel onSelect={selectSearchResult} onCancel={() => setMode("manual")} />
      </div>
    );
  }
  return (
    <div className="page narrow">
      <PageHeader
        eyebrow={id ? "Editar RPG" : "Novo RPG"}
        title={id ? "Atualize o grimório" : "Adicione à estante"}
        description="Os campos são validados novamente no servidor."
        action={!id && mode === "manual" ? (
          <button type="button" className="secondary-button" onClick={() => setMode("search")}>
            <Search size={16} />
            Buscar online
          </button>
        ) : undefined}
      />
      {mode === "preview" && (
        <p className="section-note online-search-banner">
          {form.reusePublicationId
            ? "Já existe no catálogo do RPG Manager. Revise antes de salvar."
            : form.metadataSource === "URL_IMPORT"
              ? "Dados importados de uma página externa. Revise antes de salvar."
              : "Dados de: Open Library. Revise antes de salvar."}{" "}
          <button type="button" className="ghost-button" onClick={() => setMode("search")}>Buscar outro</button>
        </p>
      )}
      {mode === "preview" && sparseImport && (
        <p className="form-error" role="alert">
          Encontramos apenas parte dos dados desta página. Revise e complete antes de salvar.
        </p>
      )}
      <form className="panel form-grid" onSubmit={submit}>
        {/* Trava todos os campos enquanto os dados reais do RPG ainda carregam: evita que uma
            digitação nesse intervalo seja descartada quando a resposta do GET chegar e
            substituir o formulário pelos dados corretos (ver useEffect acima). */}
        <fieldset className="rpg-form-fields" disabled={loading}>
        <label className="span-2">
          Título
          <input
            value={String(form.title)}
            onChange={(e) => update("title", e.target.value)}
            maxLength={160}
            required
          />
          {fieldError("title") && <span className="field-error">{fieldError("title")}</span>}
        </label>
        <label className="span-2">
          Subtítulo (opcional)
          <input
            value={String(form.subtitle)}
            onChange={(e) => update("subtitle", e.target.value)}
            maxLength={200}
          />
          {fieldError("subtitle") && <span className="field-error">{fieldError("subtitle")}</span>}
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
          {fieldError("plannedPlayDate") && <span className="field-error">{fieldError("plannedPlayDate")}</span>}
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
          {fieldError("coverUrl") && <span className="field-error">{fieldError("coverUrl")}</span>}
        </label>
        <label>
          ISBN (opcional)
          <input value={String(form.isbn)} onChange={(e) => update("isbn", e.target.value)} maxLength={32} />
          {fieldError("isbn") && <span className="field-error">{fieldError("isbn")}</span>}
        </label>
        <label>
          Autor(es) (opcional)
          <input value={String(form.authors)} onChange={(e) => update("authors", e.target.value)} maxLength={500} />
          {fieldError("authors") && <span className="field-error">{fieldError("authors")}</span>}
        </label>
        <label>
          Editora (opcional)
          <input value={String(form.publisher)} onChange={(e) => update("publisher", e.target.value)} maxLength={160} />
          {fieldError("publisher") && <span className="field-error">{fieldError("publisher")}</span>}
        </label>
        <label>
          Ano de publicação (opcional)
          <input type="number" min={1000} max={2100} value={String(form.publicationYear)} onChange={(e) => update("publicationYear", e.target.value)} />
          {fieldError("publicationYear") && <span className="field-error">{fieldError("publicationYear")}</span>}
        </label>
        <label>
          Idioma (opcional)
          <input value={String(form.language)} onChange={(e) => update("language", e.target.value)} maxLength={40} placeholder="ex.: por, eng" />
          {fieldError("language") && <span className="field-error">{fieldError("language")}</span>}
        </label>
        <label>
          Tipo de publicação
          <select value={String(form.publicationType)} onChange={(e) => update("publicationType", e.target.value)}>
            <option value="">Não classificado</option>
            {Object.entries(PUBLICATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {fieldError("publicationType") && <span className="field-error">{fieldError("publicationType")}</span>}
        </label>
        <label>
          Fonte da capa (opcional)
          <input type="url" value={String(form.coverSourceUrl)} onChange={(e) => update("coverSourceUrl", e.target.value)} maxLength={1000} />
          {fieldError("coverSourceUrl") && <span className="field-error">{fieldError("coverSourceUrl")}</span>}
        </label>
        <label className="span-2">
          Nota da capa (opcional)
          <input value={String(form.coverSourceNote)} onChange={(e) => update("coverSourceNote", e.target.value)} maxLength={1000} />
          {fieldError("coverSourceNote") && <span className="field-error">{fieldError("coverSourceNote")}</span>}
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
        </fieldset>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button
            type="button"
            className="ghost-button"
            onClick={() => navigate(-1)}
          >
            Cancelar
          </button>
          <button className="primary-button" disabled={loading}>Salvar RPG</button>
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
        description={item.subtitle || `${item.subgenreName ?? "Sem subgênero"} · ${item.readiness}`}
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
          <CoverUploadControls item={item} onChange={(next) => setData((current) => (current ? { ...current, item: next } : current))} />
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
            {item.authors ? <div><dt>Autor(es)</dt><dd>{item.authors}</dd></div> : null}
            {item.publisher ? <div><dt>Editora</dt><dd>{item.publisher}{item.publicationYear ? ` (${item.publicationYear})` : ""}</dd></div> : null}
            {item.language ? <div><dt>Idioma</dt><dd>{item.language}</dd></div> : null}
            <div><dt>Tipo</dt><dd>{PUBLICATION_TYPE_LABELS[item.publicationType] ?? "Não classificado"}</dd></div>
            {item.isbn ? <div><dt>ISBN</dt><dd>{item.isbn}</dd></div> : null}
            {item.coverSourceUrl ? <div><dt>Fonte da capa</dt><dd><a href={item.coverSourceUrl} target="_blank" rel="noreferrer">Abrir fonte</a></dd></div> : null}
            <div><dt>Origem do cadastro</dt><dd>{item.metadataSource === "OPEN_LIBRARY" ? "Open Library" : item.metadataSource === "URL_IMPORT" ? "Página importada" : "Manual"}</dd></div>
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
