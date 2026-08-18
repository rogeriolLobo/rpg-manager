import { CalendarDays, Clock3, History, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { TEMPORAL_PRECISIONS, type TemporalPrecision } from '../../domain/content/types';
import { api, deleteApi, patchJson, postJson, putJson } from '../api/client';
import { useResource } from '../api/use-resource';
import { ResourceFallback } from '../components/resource-state';
import { displayLabel } from '../labels';
import { Empty, PageHeader } from './dashboard-page';

interface Era { id: string; name: string; description: string; sortOrder: number }
interface CalendarConfig {
  id: string;
  name: string;
  months: Array<{ name: string; days: number }>;
  weekdays: string[];
  cycles: Array<{ name: string; lengthDays: number; offset: number }>;
  holidays: Array<{ name: string; monthIndex: number; day: number; description: string }>;
}
interface TimelineEvent {
  id: string;
  name: string;
  summary: string;
  description: string;
  visibility: string;
  temporal: {
    historicalDate: string;
    sortKey: number | null;
    precision: TemporalPrecision;
    eraId: string | null;
    eraName: string | null;
    calendarId: string | null;
    calendarDate: { year: number; monthIndex: number; day: number } | null;
    displayText: string;
  };
}
interface TimelineData { world: { id: string; name: string; isOwner: boolean }; eras: Era[]; calendar: CalendarConfig | null; events: TimelineEvent[] }
interface Relation { id: string; source: { id: string; name: string }; target: { id: string; name: string }; relationType: string; label: string }

function CalendarEditor({ worldId, calendar, onSaved }: { worldId: string; calendar: CalendarConfig | null; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(calendar?.name ?? 'Calendário do World');
  const [months, setMonths] = useState(calendar?.months.map((month) => `${month.name}:${month.days}`).join('\n') ?? 'Primeiro Mês:30');
  const [weekdays, setWeekdays] = useState(calendar?.weekdays.join(', ') ?? 'Primeiro Dia, Segundo Dia');
  const [cycles, setCycles] = useState(calendar?.cycles.map((cycle) => `${cycle.name}:${cycle.lengthDays}:${cycle.offset}`).join('\n') ?? '');
  const [holidays, setHolidays] = useState(calendar?.holidays.map((holiday) => `${holiday.name}:${calendar.months[holiday.monthIndex]?.name}:${holiday.day}:${holiday.description}`).join('\n') ?? '');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const parsedMonths = months.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.lastIndexOf(':');
        if (separator < 1) throw new Error('Use “Nome do mês:dias” em cada linha.');
        return { name: line.slice(0, separator).trim(), days: Number(line.slice(separator + 1)) };
      });
      const parsedWeekdays = weekdays.split(',').map((value) => value.trim()).filter(Boolean);
      const parsedCycles = cycles.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [cycleName, lengthDays, offset = '0'] = line.split(':').map((value) => value.trim());
        return { name: cycleName, lengthDays: Number(lengthDays), offset: Number(offset) };
      });
      const monthIndexes = new Map(parsedMonths.map((month, index) => [month.name.toLocaleLowerCase('pt-BR'), index]));
      const parsedHolidays = holidays.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [holidayName, monthName, day, ...description] = line.split(':').map((value) => value.trim());
        const monthIndex = monthIndexes.get(monthName.toLocaleLowerCase('pt-BR'));
        if (monthIndex === undefined) throw new Error(`Mês desconhecido no feriado “${holidayName}”.`);
        return { name: holidayName, monthIndex, day: Number(day), description: description.join(':') };
      });
      await putJson(`/timeline/worlds/${worldId}/calendar`, { name, months: parsedMonths, weekdays: parsedWeekdays, cycles: parsedCycles, holidays: parsedHolidays });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o calendário.'); }
    finally { setSaving(false); }
  };
  return <details className="panel calendar-editor"><summary><CalendarDays size={18}/>Configurar calendário fictício</summary><form className="form-grid" onSubmit={submit}>
    <label className="span-2">Nome<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)}/></label>
    <label>Meses <small>Uma linha por mês: nome:dias</small><textarea aria-label="Meses do calendário" required rows={6} value={months} onChange={(event) => setMonths(event.target.value)}/></label>
    <label>Dias da semana <small>Separados por vírgula</small><textarea aria-label="Dias da semana" required rows={6} value={weekdays} onChange={(event) => setWeekdays(event.target.value)}/></label>
    <label>Ciclos <small>nome:duração:deslocamento</small><textarea aria-label="Ciclos do calendário" rows={5} value={cycles} onChange={(event) => setCycles(event.target.value)}/></label>
    <label>Feriados <small>nome:mês:dia:descrição</small><textarea aria-label="Feriados do calendário" rows={5} value={holidays} onChange={(event) => setHolidays(event.target.value)}/></label>
    {error && <p className="form-error span-2">{error}</p>}<div className="form-actions span-2"><button className="primary-button" disabled={saving}><Save size={16}/>{saving ? 'Salvando…' : 'Salvar calendário'}</button></div>
  </form></details>;
}

function EraManager({ worldId, eras, onSaved }: { worldId: string; eras: Era[]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(''); const [sortOrder, setSortOrder] = useState('0'); const [error, setError] = useState('');
  const create = async (event: FormEvent) => { event.preventDefault(); setError(''); try { await postJson(`/timeline/worlds/${worldId}/eras`, { name, description: '', sortOrder: Number(sortOrder) }); setName(''); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a era.'); } };
  return <section className="panel era-manager"><div className="section-heading"><div><h2>Eras</h2><p className="section-note">Ordenam períodos sem presumir datas gregorianas.</p></div></div><ul className="clean-list">{eras.map((era) => <li key={era.id}><span><strong>{era.name}</strong><small>ordem {era.sortOrder}</small></span><button className="ghost-button" aria-label={`Arquivar era ${era.name}`} onClick={async () => { try { await deleteApi(`/timeline/eras/${era.id}`); await onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível arquivar.'); } }}><Trash2 size={15}/></button></li>)}</ul><form className="inline-form" onSubmit={create}><label>Nova era<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)}/></label><label>Ordem<input type="number" min="-9999" max="9999" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}/></label><button className="secondary-button"><Plus size={16}/>Criar</button></form>{error && <p className="form-error">{error}</p>}</section>;
}

function EventDateEditor({ event, data, onSaved, onCancel }: { event: TimelineEvent; data: TimelineData; onSaved: () => Promise<void>; onCancel: () => void }) {
  const date = event.temporal.calendarDate;
  const [draft, setDraft] = useState({
    historicalDate: event.temporal.historicalDate,
    sortKey: event.temporal.sortKey === null ? '' : String(event.temporal.sortKey),
    eraId: event.temporal.eraId ?? '',
    precision: event.temporal.precision,
    displayText: event.temporal.displayText,
    calendarEnabled: Boolean(date), year: date ? String(date.year) : '', monthIndex: date ? String(date.monthIndex) : '0', day: date ? String(date.day) : '1',
  });
  const [error, setError] = useState('');
  const submit = async (formEvent: FormEvent) => { formEvent.preventDefault(); setError(''); try {
    await patchJson(`/timeline/events/${event.id}`, {
      historicalDate: draft.historicalDate,
      sortKey: draft.sortKey ? Number(draft.sortKey) : null,
      eraId: draft.eraId || null,
      precision: draft.precision,
      displayText: draft.displayText,
      calendarDate: draft.calendarEnabled ? { year: Number(draft.year), monthIndex: Number(draft.monthIndex), day: Number(draft.day) } : null,
    }); await onSaved();
  } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a data.'); } };
  return <form className="panel event-date-editor form-grid" onSubmit={submit}><div className="span-2 section-heading"><div><span className="eyebrow">Data do evento</span><h2>{event.name}</h2></div><button type="button" className="ghost-button" onClick={onCancel}>Fechar</button></div>
    <label>Data histórica textual<input maxLength={160} value={draft.historicalDate} onChange={(e) => setDraft({ ...draft, historicalDate: e.target.value })} placeholder="Ano 40 da Era Imperial"/></label>
    <label>Chave de ordenação<input type="number" value={draft.sortKey} onChange={(e) => setDraft({ ...draft, sortKey: e.target.value })}/></label>
    <label>Era<select aria-label="Era do evento" value={draft.eraId} onChange={(e) => setDraft({ ...draft, eraId: e.target.value })}><option value="">Sem era</option>{data.eras.map((era) => <option key={era.id} value={era.id}>{era.name}</option>)}</select></label>
    <label>Precisão<select aria-label="Precisão temporal" value={draft.precision} onChange={(e) => setDraft({ ...draft, precision: e.target.value as TemporalPrecision })}>{TEMPORAL_PRECISIONS.map((precision) => <option key={precision} value={precision}>{displayLabel(precision)}</option>)}</select></label>
    <label className="span-2">Texto exibido<input maxLength={160} value={draft.displayText} onChange={(e) => setDraft({ ...draft, displayText: e.target.value })} placeholder="1 de Aurora, ano -40"/></label>
    {data.calendar && <fieldset className="span-2 calendar-date-fields"><legend><label className="check-row"><input type="checkbox" checked={draft.calendarEnabled} onChange={(e) => setDraft({ ...draft, calendarEnabled: e.target.checked })}/>Usar {data.calendar.name}</label></legend>{draft.calendarEnabled && <><label>Ano<input aria-label="Ano do World" required type="number" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })}/></label><label>Mês<select aria-label="Mês do World" value={draft.monthIndex} onChange={(e) => setDraft({ ...draft, monthIndex: e.target.value })}>{data.calendar.months.map((month, index) => <option key={month.name} value={index}>{month.name}</option>)}</select></label><label>Dia<input aria-label="Dia do World" required type="number" min="1" max={data.calendar.months[Number(draft.monthIndex)]?.days ?? 1} value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })}/></label></>}</fieldset>}
    {error && <p className="form-error span-2">{error}</p>}<div className="form-actions span-2"><button type="button" className="ghost-button" onClick={onCancel}>Cancelar</button><button className="primary-button">Salvar data</button></div>
  </form>;
}

function eventDateLabel(event: TimelineEvent, calendar: CalendarConfig | null): string {
  if (event.temporal.displayText) return event.temporal.displayText;
  if (event.temporal.calendarDate && calendar) {
    const { year, monthIndex, day } = event.temporal.calendarDate;
    return `${day} de ${calendar.months[monthIndex]?.name ?? `mês ${monthIndex + 1}`}, ano ${year}`;
  }
  return event.temporal.historicalDate || 'Data ainda não definida';
}

interface TimelineResource { timeline: TimelineData; relations: Relation[] }
export function WorldTimelinePage() {
  const { id: worldId = '' } = useParams(); const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const query = useMemo(() => { const params = new URLSearchParams(); for (const key of ['search', 'eraId', 'precision']) { const value = searchParams.get(key); if (value) params.set(key, value); } return params.toString(); }, [searchParams]);
  const resource = useResource<TimelineResource>(`${worldId}?${query}`, () =>
    Promise.all([api<TimelineData>(`/timeline/worlds/${worldId}?${query}`), api<{ relations: Relation[] }>(`/relations/worlds/${worldId}?includeDisconnected=false`)])
      .then(([timeline, graph]) => ({ timeline, relations: graph.relations })));
  const load = async () => { resource.reload(); };
  const update = (key: string, value: string) => setSearchParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; });
  if (resource.status !== 'success') return <ResourceFallback state={resource} onRetry={resource.reload}/>;
  const { relations } = resource.data;
  const data = resource.data.timeline;
  const relatedTo = (eventId: string) => relations.filter((relation) => relation.source.id === eventId || relation.target.id === eventId).map((relation) => relation.source.id === eventId ? relation.target : relation.source);
  return <div className="page timeline-page"><PageHeader eyebrow="Cronologia do World" title={data.world.name} description="Eventos históricos e calendários fictícios, separados das datas reais das sessões." action={data.world.isOwner ? <Link className="primary-button link-button" to={`/app/vault/new?worldId=${worldId}&type=EVENT`}><Plus size={17}/>Novo evento</Link> : undefined}/>
    {data.world.isOwner && <div className="timeline-settings"><EraManager worldId={worldId} eras={data.eras} onSaved={load}/><CalendarEditor key={data.calendar?.id ?? 'new'} worldId={worldId} calendar={data.calendar} onSaved={load}/></div>}
    {editing && (
      <EventDateEditor event={editing} data={data} onSaved={async () => { setEditing(null); await load(); }} onCancel={() => setEditing(null)}/>
    )}
    <section className="panel timeline-filters"><label className="search-box"><Clock3/><input aria-label="Buscar na Timeline" value={searchParams.get('search') ?? ''} onChange={(event) => update('search', event.target.value)} placeholder="Evento ou data histórica"/></label><select aria-label="Filtrar por era" value={searchParams.get('eraId') ?? ''} onChange={(event) => update('eraId', event.target.value)}><option value="">Todas as eras</option>{data.eras.map((era) => <option key={era.id} value={era.id}>{era.name}</option>)}</select><select aria-label="Filtrar por precisão" value={searchParams.get('precision') ?? ''} onChange={(event) => update('precision', event.target.value)}><option value="">Toda precisão</option>{TEMPORAL_PRECISIONS.map((precision) => <option key={precision} value={precision}>{displayLabel(precision)}</option>)}</select></section>
    {data.events.length ? (
      <section className="timeline-track" aria-label="Linha do tempo">{data.events.map((event) => { const related = relatedTo(event.id); return <article className="timeline-event" key={event.id}><div className="timeline-marker"><History/></div><div className="panel"><div className="entity-card-heading"><span>{event.temporal.eraName || 'Sem era'}</span><span>{displayLabel(event.temporal.precision)}</span></div><time>{eventDateLabel(event, data.calendar)}</time><h2><Link to={`/app/vault/${event.id}`}>{event.name}</Link></h2><p>{event.summary || 'Sem resumo.'}</p>{related.length > 0 && <div className="related-entities"><strong>Relacionado a</strong>{related.map((entity) => <Link key={entity.id} to={`/app/vault/${entity.id}`}>{entity.name}</Link>)}</div>}{data.world.isOwner && <button className="secondary-button" onClick={() => setEditing(event)}>Configurar data</button>}</div></article>; })}</section>
    ) : (
      <Empty title="Nenhum evento na Timeline" text="Crie entidades EVENT no World e defina sua ordem histórica." action="Criar evento" to={`/app/vault/new?worldId=${worldId}&type=EVENT`}/>
    )}
  </div>;
}
