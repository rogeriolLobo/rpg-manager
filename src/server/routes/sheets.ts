import { Hono, type Context } from 'hono';
import { validateSheet, type SheetFieldDefinition, type SheetTemplate } from '../../domain/sheets';
import { characterSheetInputSchema, sheetTemplateInputSchema } from '../../shared/validation/schemas';
import { authorizedEntity, ownedEntity, ownedWorld, type AuthorizedEntityRow } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

// F-020 (BATCH9): Character Sheet Engine base — modelo declarativo (sheet_templates) +
// valores por entidade (character_sheets), aplicável a Vault Entities do tipo CHARACTER e
// NPC. Mesmo padrão comprovado por creature_stat_templates/creature_stat_blocks
// (src/server/routes/bestiary.ts), generalizado com world_id opcional e versionamento —
// ver migrations/0029_character_sheets.sql para a justificativa completa.
//
// Autorização: leitura de ficha segue authorizedEntity (mesma visibilidade da entidade —
// PLAYERS/GM_ONLY nunca vaza); escrita segue ownedEntity, pois o produto não tem
// co-edição de Vault Entity (mesmo limite já documentado em src/server/routes/vault.ts).

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
interface TemplateRow { id:string; owner_user_id:string; world_id:string|null; world_name:string|null; name:string; description:string; version:number; field_definitions:string; created_at:string; updated_at:string }
interface SheetRow { entity_id:string; template_id:string; template_version:number; values_json:string; created_at:string; updated_at:string; template_name:string; current_template_version:number; field_definitions:string }
interface SheetEntityRow extends AuthorizedEntityRow { entity_type:string; world_id:string|null }

export const sheetRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function parseFields(json: string, context: string): SheetFieldDefinition[] {
  try { return JSON.parse(json) as SheetFieldDefinition[]; }
  catch (cause) { throw new Error(`Invalid stored sheet template ${context}`, { cause }); }
}

function presentTemplate(row: TemplateRow) {
  return { id: row.id, worldId: row.world_id, worldName: row.world_name, name: row.name, description: row.description, version: row.version, fields: parseFields(row.field_definitions, row.id), createdAt: row.created_at, updatedAt: row.updated_at };
}

async function ownedTemplate(c: AppContext, id: string): Promise<TemplateRow> {
  const row = await c.env.DB.prepare('SELECT t.*,w.name world_name FROM sheet_templates t LEFT JOIN worlds w ON w.id=t.world_id WHERE t.id=? AND t.owner_user_id=?')
    .bind(id, c.get('user').id).first<TemplateRow>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Modelo de ficha não encontrado.');
  return row;
}

async function sheetEntity(c: AppContext, id: string, mode: 'read' | 'write'): Promise<SheetEntityRow> {
  const row = (mode === 'write' ? await ownedEntity(c, id) : await authorizedEntity(c, id)) as SheetEntityRow;
  if (row.entity_type !== 'CHARACTER' && row.entity_type !== 'NPC') throw new ApiError(422, 'INVALID_ENTITY_TYPE', 'Fichas só podem ser vinculadas a Personagens ou NPCs.');
  return row;
}

sheetRoutes.get('/templates', async (c) => {
  const worldFilter = c.req.query('worldId');
  const rows = await c.env.DB.prepare(`SELECT t.*,w.name world_name FROM sheet_templates t LEFT JOIN worlds w ON w.id=t.world_id WHERE t.owner_user_id=?${worldFilter ? ' AND (t.world_id=? OR t.world_id IS NULL)' : ''} ORDER BY t.name COLLATE NOCASE`)
    .bind(...(worldFilter ? [c.get('user').id, worldFilter] : [c.get('user').id])).all<TemplateRow>();
  return c.json({ items: rows.results.map(presentTemplate) });
});

sheetRoutes.post('/templates', async (c) => {
  const input = await readJson(c, sheetTemplateInputSchema);
  if (input.worldId) await ownedWorld(c, input.worldId);
  const id = crypto.randomUUID(), now = nowIso();
  await c.env.DB.prepare('INSERT INTO sheet_templates (id,owner_user_id,world_id,name,description,version,field_definitions,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
    .bind(id, c.get('user').id, input.worldId, input.name, input.description, JSON.stringify(input.fields), now, now).run();
  return c.json({ id }, 201);
});

sheetRoutes.patch('/templates/:id', async (c) => {
  const current = await ownedTemplate(c, c.req.param('id'));
  const input = await readJson(c, sheetTemplateInputSchema);
  if (input.worldId) await ownedWorld(c, input.worldId);
  const sheets = await c.env.DB.prepare('SELECT values_json FROM character_sheets WHERE template_id=?').bind(c.req.param('id')).all<{ values_json: string }>();
  const keys = new Set(input.fields.map((field) => field.key));
  if (sheets.results.some((sheet) => Object.keys(JSON.parse(sheet.values_json) as Record<string, unknown>).some((key) => !keys.has(key))))
    throw new ApiError(409, 'TEMPLATE_FIELDS_IN_USE', 'Remova os valores dos campos excluídos antes de alterar o modelo.');
  const nextFields = JSON.stringify(input.fields);
  const version = nextFields !== current.field_definitions ? current.version + 1 : current.version;
  await c.env.DB.prepare('UPDATE sheet_templates SET world_id=?,name=?,description=?,version=?,field_definitions=?,updated_at=? WHERE id=? AND owner_user_id=?')
    .bind(input.worldId, input.name, input.description, version, nextFields, nowIso(), c.req.param('id'), c.get('user').id).run();
  return c.json({ success: true, version });
});

sheetRoutes.delete('/templates/:id', async (c) => {
  await ownedTemplate(c, c.req.param('id'));
  const usage = await c.env.DB.prepare('SELECT COUNT(*) total FROM character_sheets WHERE template_id=?').bind(c.req.param('id')).first<{ total: number }>();
  if (Number(usage?.total)) throw new ApiError(409, 'TEMPLATE_IN_USE', 'O modelo está em uso por uma ou mais fichas.');
  await c.env.DB.prepare('DELETE FROM sheet_templates WHERE id=? AND owner_user_id=?').bind(c.req.param('id'), c.get('user').id).run();
  return c.body(null, 204);
});

sheetRoutes.get('/entities/:entityId', async (c) => {
  await sheetEntity(c, c.req.param('entityId'), 'read');
  const row = await c.env.DB.prepare('SELECT s.*,t.name template_name,t.version current_template_version,t.field_definitions FROM character_sheets s JOIN sheet_templates t ON t.id=s.template_id WHERE s.entity_id=?')
    .bind(c.req.param('entityId')).first<SheetRow>();
  if (!row) return c.json({ item: null });
  return c.json({ item: {
    entityId: row.entity_id, templateId: row.template_id, templateName: row.template_name,
    templateVersion: row.template_version, currentTemplateVersion: row.current_template_version,
    outdated: row.template_version !== row.current_template_version,
    fields: parseFields(row.field_definitions, row.template_id), values: JSON.parse(row.values_json) as Record<string, unknown>,
    createdAt: row.created_at, updatedAt: row.updated_at,
  } });
});

sheetRoutes.put('/entities/:entityId', async (c) => {
  const entity = await sheetEntity(c, c.req.param('entityId'), 'write');
  const input = await readJson(c, characterSheetInputSchema);
  const template = await c.env.DB.prepare('SELECT * FROM sheet_templates WHERE id=? AND owner_user_id=?').bind(input.templateId, c.get('user').id).first<TemplateRow>();
  if (!template) throw new ApiError(422, 'INVALID_TEMPLATE', 'Modelo de ficha inválido.');
  if (template.world_id && template.world_id !== entity.world_id) throw new ApiError(422, 'TEMPLATE_WORLD_MISMATCH', 'Este modelo pertence a outro World.');
  const sheetTemplate: SheetTemplate = { id: template.id, name: template.name, version: template.version, fields: parseFields(template.field_definitions, template.id) };
  const result = validateSheet(sheetTemplate, input.values as Record<string, string | number | boolean>);
  // Client (ClientApiError.fields) espera o mesmo formato de src/server/http.ts para
  // VALIDATION_ERROR (zod flatten: Record<string,string[]>) — validateSheet devolve uma
  // única mensagem por campo (contrato travado por tests/unit/future-architecture.test.ts),
  // então convertemos aqui na borda HTTP, sem alterar o domínio puro.
  if (!result.valid) throw new ApiError(422, 'INVALID_SHEET_VALUES', 'Os valores da ficha não correspondem ao modelo selecionado.', Object.fromEntries(Object.entries(result.errors).map(([key, message]) => [key, [message]])));
  const now = nowIso();
  await c.env.DB.prepare(`INSERT INTO character_sheets (entity_id,template_id,template_version,values_json,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(entity_id) DO UPDATE SET template_id=excluded.template_id,template_version=excluded.template_version,values_json=excluded.values_json,updated_at=excluded.updated_at`)
    .bind(entity.id, template.id, template.version, JSON.stringify(input.values), now, now).run();
  return c.json({ success: true });
});

sheetRoutes.delete('/entities/:entityId', async (c) => {
  await sheetEntity(c, c.req.param('entityId'), 'write');
  await c.env.DB.prepare('DELETE FROM character_sheets WHERE entity_id=?').bind(c.req.param('entityId')).run();
  return c.body(null, 204);
});
