// F-001: Revision History — camada compartilhada de escrita/leitura de
// `entity_revisions`, usada por vault.ts, journal.ts e worlds.ts. Nenhuma
// autorização acontece aqui — cada rota já resolveu o dono ATUAL do recurso
// vivo (via ownedEntity/ownedWorld) antes de chamar qualquer função deste
// arquivo; ver docs/product/RPG_MANAGER_FINAL_STATUS.md (seção F-001,
// "Autorização") para o raciocínio completo.
import type { ZodType } from 'zod';
import type { RevisionAction, RevisionResourceType } from '../../domain/content/revision';
import { ApiError } from '../http';

export function recordRevisionStatement(
  db: D1Database,
  params: {
    resourceType: RevisionResourceType; resourceId: string; ownerUserId: string; actorUserId: string;
    action: RevisionAction; snapshot: unknown; restoredFromRevisionNumber?: number | null; now: string;
  },
): D1PreparedStatement {
  // revision_number = MAX atual + 1, calculado na MESMA instrução (subquery escalar) — nunca um
  // read-then-write separado, então não há corrida possível entre duas revisões concorrentes do
  // mesmo recurso (não deveria acontecer já que só o dono escreve, mas a garantia é grátis).
  return db.prepare(`INSERT INTO entity_revisions
      (id,resource_type,resource_id,owner_user_id,actor_user_id,action,revision_number,snapshot,restored_from_revision_number,created_at)
      VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(revision_number),0)+1 FROM entity_revisions WHERE resource_type=? AND resource_id=?),?,?,?)`)
    .bind(
      crypto.randomUUID(), params.resourceType, params.resourceId, params.ownerUserId, params.actorUserId, params.action,
      params.resourceType, params.resourceId,
      JSON.stringify(params.snapshot), params.restoredFromRevisionNumber ?? null, params.now,
    );
}

interface RevisionSummaryRow {
  revision_number: number; action: RevisionAction; actor_user_id: string; actor_name: string;
  restored_from_revision_number: number | null; created_at: string;
}
interface RevisionDetailRow extends RevisionSummaryRow { snapshot: string }

function presentSummary(row: RevisionSummaryRow) {
  return {
    revisionNumber: row.revision_number, action: row.action, actorUserId: row.actor_user_id, actorName: row.actor_name,
    restoredFromRevisionNumber: row.restored_from_revision_number, createdAt: row.created_at,
  };
}

const SUMMARY_COLUMNS = 'r.revision_number,r.action,r.actor_user_id,u.display_name actor_name,r.restored_from_revision_number,r.created_at';

// Paginado deliberadamente (seção 24 do pedido: histórico não pode virar N+1/carga ilimitada) —
// nunca uma tela carrega "todas as revisões" de uma vez.
export async function listRevisions(db: D1Database, resourceType: RevisionResourceType, resourceId: string, page: number, pageSize: number) {
  const [rows, count] = await db.batch([
    db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM entity_revisions r JOIN users u ON u.id=r.actor_user_id
      WHERE r.resource_type=? AND r.resource_id=? ORDER BY r.revision_number DESC LIMIT ? OFFSET ?`)
      .bind(resourceType, resourceId, pageSize, (page - 1) * pageSize),
    db.prepare('SELECT COUNT(*) total FROM entity_revisions WHERE resource_type=? AND resource_id=?').bind(resourceType, resourceId),
  ]);
  return {
    items: (rows.results as unknown as RevisionSummaryRow[]).map(presentSummary),
    total: Number((count.results[0] as { total: number }).total),
  };
}

export async function getRevision(db: D1Database, resourceType: RevisionResourceType, resourceId: string, revisionNumber: number) {
  const row = await db.prepare(`SELECT ${SUMMARY_COLUMNS},r.snapshot FROM entity_revisions r JOIN users u ON u.id=r.actor_user_id
    WHERE r.resource_type=? AND r.resource_id=? AND r.revision_number=?`)
    .bind(resourceType, resourceId, revisionNumber).first<RevisionDetailRow>();
  return row ? { ...presentSummary(row), snapshotRaw: row.snapshot } : null;
}

export function parseRevisionNumber(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new ApiError(422, 'INVALID_REVISION', 'Número de revisão inválido.');
  return value;
}

// Uma revisão restaurada precisa passar pela MESMA validação de um create/update normal — se os
// dados guardados referenciam algo que não existe mais (ex.: um grupo apagado), o erro é o mesmo
// que o usuário veria digitando aquilo de novo, nunca um comportamento especial de restore
// (seção 7 do pedido: "documentar a limitação, não escondê-la" — aqui a limitação é honesta:
// a própria validação normal do formulário).
export function parseSnapshot<T>(schema: ZodType<T>, snapshotJson: string): T {
  // JSON.parse não deveria falhar nunca (somos nós que escrevemos via JSON.stringify) — se
  // falhar mesmo assim, deixa subir como erro genérico (o handler global do app já responde
  // 500 seguro, sem vazar detalhe interno) em vez de inventar um novo código de status aqui.
  const raw: unknown = JSON.parse(snapshotJson);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Os dados desta revisão não são mais compatíveis com o formulário atual.', parsed.error.flatten().fieldErrors);
  return parsed.data;
}
