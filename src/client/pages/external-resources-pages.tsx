import { ExternalLink, Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { deleteApi, postJson } from "../api/client";
import { useResource } from "../api/use-resource";
import { ResourceFallback } from "../components/resource-state";
import { Empty, PageHeader } from "./dashboard-page";

// F-003 (External Resources): referência externa (link HTTPS) zero-cost, escopada por World —
// ver src/server/routes/external-resources.ts para a justificativa de não ser um Vault Entity.
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ARTICLE: "Artigo", IMAGE: "Imagem", MAP: "Mapa", PDF: "PDF", VIDEO: "Vídeo", AUDIO: "Áudio", OTHER: "Outro",
};

interface ExternalResource {
  id: string; title: string; url: string; description: string; resourceType: string; createdAt: string; updatedAt: string;
}
interface ExternalResourcesData {
  world: { id: string; name: string; isOwner: boolean };
  items: ExternalResource[];
}

const blankForm = { title: "", url: "", description: "", resourceType: "ARTICLE" };

export function WorldExternalResourcesPage() {
  const { id } = useParams();
  const resource = useResource<ExternalResourcesData>(id ? `/external-resources/${id}` : null);
  const [form, setForm] = useState(blankForm);
  const [error, setError] = useState("");

  if (resource.status !== "success") return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const data = resource.data;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await postJson(`/external-resources/${id}`, form);
      setForm(blankForm);
      resource.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o recurso.");
    }
  };

  const remove = async (resourceId: string) => {
    if (!confirm("Remover este recurso externo?")) return;
    try {
      await deleteApi(`/external-resources/${id}/${resourceId}`);
      resource.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o recurso.");
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Recursos externos"
        title={data.world.name}
        description="Links de referência (mapas, artigos, PDFs) organizados por World — sem upload, sem custo."
      />
      {data.items.length === 0 ? (
        <Empty
          title="Nenhum recurso externo ainda"
          text={data.world.isOwner ? "Adicione o primeiro link de referência abaixo." : "O narrador ainda não adicionou nenhum link de referência."}
          action="Ver Diário"
          to={`/app/worlds/${id}/journal`}
        />
      ) : (
        <ul className="clean-list external-resource-list">
          {data.items.map((resource) => (
            <li key={resource.id}>
              <a href={resource.url} target="_blank" rel="noreferrer" className="external-resource-link">
                <ExternalLink size={17}/>
                <span>
                  <strong>{resource.title}</strong>
                  <small>{RESOURCE_TYPE_LABELS[resource.resourceType] ?? resource.resourceType}{resource.description ? ` · ${resource.description}` : ""}</small>
                </span>
              </a>
              {data.world.isOwner && (
                <button type="button" className="icon-button" aria-label={`Remover ${resource.title}`} onClick={() => void remove(resource.id)}>
                  <Trash2 size={16}/>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.world.isOwner && (
        <form className="panel form-grid" onSubmit={(event) => void submit(event)}>
          <h2 className="span-2"><LinkIcon size={19}/>Novo recurso externo</h2>
          <label className="span-2">Título
            <input required maxLength={160} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}/>
          </label>
          <label className="span-2">URL
            <input required type="url" maxLength={2000} placeholder="https://…" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}/>
          </label>
          <label>Tipo
            <select value={form.resourceType} onChange={(event) => setForm((current) => ({ ...current, resourceType: event.target.value }))}>
              {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="span-2">Descrição (opcional)
            <input maxLength={2000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}/>
          </label>
          {error && <p className="form-error span-2">{error}</p>}
          <div className="form-actions span-2">
            <button className="primary-button"><Plus size={17}/>Adicionar recurso</button>
          </div>
        </form>
      )}
      {error && !data.world.isOwner && <p className="form-error">{error}</p>}
    </div>
  );
}
