import { History, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, postJson } from '../api/client';
import { Loading } from '../pages/dashboard-page';

// F-001: componente genérico de histórico de revisões, reaproveitado por Vault entities,
// Journal pages e Worlds (mesmo contrato de API nos três — GET .../revisions,
// GET .../revisions/:number, POST .../revisions/:number/restore — ver
// src/server/content/revisions.ts). Ação contextual na própria tela do recurso, nunca um item
// de navegação global (seção 10 do pedido).

export interface RevisionSummary {
  revisionNumber: number;
  action: 'CREATE' | 'UPDATE' | 'RESTORE';
  actorUserId: string;
  actorName: string;
  restoredFromRevisionNumber: number | null;
  createdAt: string;
}
interface RevisionDetail extends RevisionSummary { snapshot: Record<string, unknown> }

const ACTION_LABELS: Record<RevisionSummary['action'], string> = { CREATE: 'Criação', UPDATE: 'Edição', RESTORE: 'Restauração' };

// Os três formatos de snapshot (VaultEntityInput/JournalPageInput/WorldInput) não têm um campo
// em comum com o mesmo nome para "título" — em vez de três renderizações bespoke, uma leitura
// genérica dos campos mais prováveis é suficiente para o objetivo desta tela (dar contexto
// visual antes de restaurar, não substituir o formulário real).
function snapshotLabel(snapshot: Record<string, unknown>): string {
  const value = snapshot.name ?? snapshot.title;
  return typeof value === 'string' && value ? value : 'Sem título';
}
function snapshotExcerpt(snapshot: Record<string, unknown>): string {
  const value = snapshot.description ?? snapshot.content ?? snapshot.summary;
  const text = typeof value === 'string' ? value : '';
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function RevisionHistoryButton({ basePath, canRestore, onRestored }: { basePath: string; canRestore: boolean; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ghost-button" onClick={() => setOpen(true)}><History size={15} />Histórico</button>
      {open && (
        <RevisionHistoryModal
          basePath={basePath}
          canRestore={canRestore}
          onClose={() => setOpen(false)}
          onRestored={() => { setOpen(false); onRestored(); }}
        />
      )}
    </>
  );
}

function RevisionHistoryModal({ basePath, canRestore, onClose, onRestored }: { basePath: string; canRestore: boolean; onClose: () => void; onRestored: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'success'; items: RevisionSummary[] } | { status: 'error'; message: string }>({ status: 'loading' });
  const [selected, setSelected] = useState<RevisionDetail | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    api<{ items: RevisionSummary[] }>(`${basePath}/revisions?pageSize=50`)
      .then((result) => { if (active) setState({ status: 'success', items: result.items }); })
      .catch((reason: unknown) => { if (active) setState({ status: 'error', message: reason instanceof Error ? reason.message : 'Não foi possível carregar o histórico.' }); });
    return () => { active = false; };
  }, [basePath]);

  const viewRevision = async (revisionNumber: number) => {
    setActionError('');
    try {
      const result = await api<{ item: RevisionDetail }>(`${basePath}/revisions/${revisionNumber}`);
      setSelected(result.item);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível carregar esta revisão.');
    }
  };

  const restore = async (revisionNumber: number) => {
    // Mesmo padrão de confirm() nativo já usado em archive/remover pin/etc. no restante do app.
    if (!confirm('Restaurar esta versão? O conteúdo atual é salvo como uma nova revisão antes de restaurar — nada do histórico é apagado.')) return;
    setRestoring(true); setActionError('');
    try {
      await postJson(`${basePath}/revisions/${revisionNumber}/restore`, {});
      onRestored();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível restaurar esta revisão.');
      setRestoring(false);
    }
  };

  return (
    <div className="quick-idea-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="panel revision-history-modal" role="dialog" aria-modal="true" aria-labelledby="revision-history-heading">
        <div className="revision-history-head">
          <h2 id="revision-history-heading"><History size={18} />Histórico de revisões</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar histórico"><X size={18} /></button>
        </div>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && <p className="form-error">{state.message}</p>}
        {state.status === 'success' && (
          state.items.length === 0 ? (
            <p className="section-note">Nenhuma revisão registrada ainda.</p>
          ) : (
            <ul className="revision-list">
              {state.items.map((revision, index) => (
                <li key={revision.revisionNumber} className="revision-item">
                  <div className="revision-item-info">
                    {/* Ação nunca é indicada só por cor (seção 10 do pedido) — sempre um texto explícito no badge. */}
                    <span className={`badge revision-badge-${revision.action.toLowerCase()}`}>{ACTION_LABELS[revision.action]}</span>
                    <span className="revision-item-meta">
                      #{revision.revisionNumber} · {formatDateTime(revision.createdAt)} · {revision.actorName}
                      {revision.restoredFromRevisionNumber !== null && ` · a partir da revisão #${revision.restoredFromRevisionNumber}`}
                      {index === 0 && ' · versão atual'}
                    </span>
                  </div>
                  <div className="revision-item-actions">
                    <button type="button" className="ghost-button" onClick={() => void viewRevision(revision.revisionNumber)}>Ver</button>
                    {canRestore && index !== 0 && (
                      <button type="button" className="ghost-button" disabled={restoring} onClick={() => void restore(revision.revisionNumber)}>
                        <RotateCcw size={14} />Restaurar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
        {actionError && <p className="form-error">{actionError}</p>}
        {selected && (
          <div className="panel revision-detail-preview" role="region" aria-label={`Pré-visualização da revisão ${selected.revisionNumber}`}>
            <h3>{snapshotLabel(selected.snapshot)}</h3>
            <p className="pre-wrap">{snapshotExcerpt(selected.snapshot) || 'Sem conteúdo de texto para pré-visualizar.'}</p>
            <button type="button" className="ghost-button" onClick={() => setSelected(null)}>Fechar pré-visualização</button>
          </div>
        )}
      </div>
    </div>
  );
}
