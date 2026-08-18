import { MapPin, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, deleteApi, postJson } from "../api/client";
import { Empty, Loading, PageHeader } from "./dashboard-page";

// F-002 (Cartografia): mapas (imagem externa) + pins (coordenadas normalizadas 0-100),
// escopados por World. Versão 1.0 deliberadamente simples — NÃO é VTT (sem tokens em tempo
// real, fog of war, movimento ou WebSockets). Ver src/server/routes/cartography.ts.

interface MapSummary { id: string; title: string; imageUrl: string; notes: string }
interface Pin { id: string; label: string; notes: string; x: number; y: number; entityId: string | null; entityName: string | null }
interface MapDetail { map: { id: string; title: string; imageUrl: string; notes: string }; pins: Pin[]; isOwner: boolean }

const blankMapForm = { title: "", imageUrl: "", notes: "" };

export function WorldCartographyPage() {
  const { id } = useParams();
  const [maps, setMaps] = useState<MapSummary[]>();
  const [form, setForm] = useState(blankMapForm);
  const [error, setError] = useState("");

  const load = () => api<{ items: MapSummary[] }>(`/cartography/${id}`).then((result) => setMaps(result.items));
  useEffect(() => { void api<{ items: MapSummary[] }>(`/cartography/${id}`).then((result) => setMaps(result.items)); }, [id]);

  if (!maps) return <Loading/>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await postJson(`/cartography/${id}`, form);
      setForm(blankMapForm);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o mapa.");
    }
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Cartografia" title="Mapas do World" description="Imagens externas com pins — referência de localização, não uma mesa virtual."/>
      {maps.length === 0 ? (
        <Empty title="Nenhum mapa ainda" text="Adicione a imagem de um mapa abaixo para começar a marcar pontos de interesse." action="Ver Diário" to={`/app/worlds/${id}/journal`}/>
      ) : (
        <div className="cartography-map-grid">
          {maps.map((map) => (
            <Link key={map.id} to={`/app/worlds/${id}/cartography/${map.id}`} className="cartography-map-card">
              <img src={map.imageUrl} alt="" referrerPolicy="no-referrer"/>
              <strong>{map.title}</strong>
            </Link>
          ))}
        </div>
      )}
      <form className="panel form-grid" onSubmit={(event) => void submit(event)}>
        <h2 className="span-2"><MapPin size={19}/>Novo mapa</h2>
        <label className="span-2">Título
          <input required maxLength={160} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}/>
        </label>
        <label className="span-2">URL da imagem
          <input required type="url" maxLength={2000} placeholder="https://…" value={form.imageUrl} onChange={(event) => setForm((current) => ({ ...current, imageUrl: event.target.value }))}/>
        </label>
        <label className="span-2">Notas (opcional)
          <input maxLength={2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}/>
        </label>
        {error && <p className="form-error span-2">{error}</p>}
        <div className="form-actions span-2">
          <button className="primary-button"><Plus size={17}/>Adicionar mapa</button>
        </div>
      </form>
    </div>
  );
}

const blankPinForm = { label: "", notes: "", x: "50", y: "50", entityId: "" };

export function WorldMapDetailPage() {
  const { id, mapId } = useParams();
  const [data, setData] = useState<MapDetail>();
  const [entities, setEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState(blankPinForm);
  const [error, setError] = useState("");
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const load = () => api<MapDetail>(`/cartography/${id}/${mapId}`).then(setData);
  useEffect(() => { void api<MapDetail>(`/cartography/${id}/${mapId}`).then(setData); }, [id, mapId]);
  useEffect(() => { void api<{ items: Array<{ id: string; name: string }> }>(`/vault?worldId=${id}&pageSize=50`).then((result) => setEntities(result.items)); }, [id]);

  if (!data) return <Loading/>;

  // Clicar na imagem preenche X/Y automaticamente (conveniência) — o usuário ainda pode
  // ajustar os números manualmente. Sem drag-and-drop nesta versão (ver seção 9 do pedido).
  const clickToFill = (event: MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000) / 10;
    setForm((current) => ({ ...current, x: String(Math.min(100, Math.max(0, x))), y: String(Math.min(100, Math.max(0, y))) }));
  };

  const submitPin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await postJson(`/cartography/${id}/${mapId}/pins`, {
        label: form.label, notes: form.notes, x: Number(form.x), y: Number(form.y), entityId: form.entityId || null,
      });
      setForm(blankPinForm);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o pin.");
    }
  };

  const removePin = async (pinId: string) => {
    if (!confirm("Remover este pin?")) return;
    try {
      await deleteApi(`/cartography/${id}/${mapId}/pins/${pinId}`);
      setSelectedPin(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o pin.");
    }
  };

  return (
    <div className="page">
      <PageHeader eyebrow="Cartografia" title={data.map.title} description={data.map.notes || "Clique num pin para ver detalhes."}/>
      <div className="cartography-map-viewer panel">
        <div className="cartography-image-wrap">
          <img ref={imageRef} src={data.map.imageUrl} alt={data.map.title} referrerPolicy="no-referrer" onClick={data.isOwner ? clickToFill : undefined} className={data.isOwner ? "clickable" : ""}/>
          {data.pins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              className="map-pin"
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              aria-label={`Pin: ${pin.label}`}
              onClick={() => setSelectedPin(pin)}
            >
              <MapPin size={22}/>
            </button>
          ))}
        </div>
        {selectedPin && (
          <div className="panel map-pin-details">
            <h3>{selectedPin.label}</h3>
            {selectedPin.entityName && <p><Link to={`/app/vault/${selectedPin.entityId}`}>Ver {selectedPin.entityName}</Link></p>}
            {selectedPin.notes && <p className="pre-wrap">{selectedPin.notes}</p>}
            {data.isOwner && <button type="button" className="ghost-button" onClick={() => void removePin(selectedPin.id)}><Trash2 size={15}/>Remover pin</button>}
          </div>
        )}
      </div>
      {data.isOwner && (
        <form className="panel form-grid" onSubmit={(event) => void submitPin(event)}>
          <h2 className="span-2"><MapPin size={19}/>Novo pin {data.isOwner ? "(clique no mapa para preencher X/Y)" : ""}</h2>
          <label className="span-2">Rótulo
            <input required maxLength={160} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}/>
          </label>
          <label>X (%)
            <input required type="number" min={0} max={100} step={0.1} value={form.x} onChange={(event) => setForm((current) => ({ ...current, x: event.target.value }))}/>
          </label>
          <label>Y (%)
            <input required type="number" min={0} max={100} step={0.1} value={form.y} onChange={(event) => setForm((current) => ({ ...current, y: event.target.value }))}/>
          </label>
          <label className="span-2">Entidade vinculada (opcional)
            <select value={form.entityId} onChange={(event) => setForm((current) => ({ ...current, entityId: event.target.value }))}>
              <option value="">Nenhuma</option>
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </label>
          <label className="span-2">Notas (opcional)
            <input maxLength={2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}/>
          </label>
          {error && <p className="form-error span-2">{error}</p>}
          <div className="form-actions span-2">
            <button className="primary-button"><Plus size={17}/>Adicionar pin</button>
          </div>
        </form>
      )}
    </div>
  );
}
