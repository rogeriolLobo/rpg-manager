import { Hono, type Context } from 'hono';
import type { CreatureStatFieldDefinition } from '../../domain/content/types';
import { creatureStatTemplateInputSchema, type CreatureStatTemplateInput } from '../../shared/validation/schemas';
import { authorizedWorld, ownedWorld } from '../content/authorization';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
interface TemplateRow { id:string; world_id:string; name:string; description:string; field_definitions:string; created_at:string; updated_at:string }

export const bestiaryRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function presentTemplate(row: TemplateRow) {
  let fields: CreatureStatFieldDefinition[];
  try { fields = JSON.parse(row.field_definitions) as CreatureStatFieldDefinition[]; }
  catch (cause) { throw new Error(`Invalid stored creature template ${row.id}`, { cause }); }
  return { id:row.id, worldId:row.world_id, name:row.name, description:row.description, fields, createdAt:row.created_at, updatedAt:row.updated_at };
}

async function ownedTemplate(c: AppContext, id: string): Promise<TemplateRow> {
  const row = await c.env.DB.prepare(`SELECT t.* FROM creature_stat_templates t
    JOIN worlds w ON w.id=t.world_id WHERE t.id=? AND t.owner_user_id=? AND w.owner_user_id=?`)
    .bind(id,c.get('user').id,c.get('user').id).first<TemplateRow>();
  if (!row) throw new ApiError(404,'NOT_FOUND','Modelo de estatísticas não encontrado.');
  return row;
}

bestiaryRoutes.get('/worlds/:worldId/templates', async (c) => {
  await authorizedWorld(c,c.req.param('worldId'));
  const rows = await c.env.DB.prepare('SELECT * FROM creature_stat_templates WHERE world_id=? ORDER BY name COLLATE NOCASE')
    .bind(c.req.param('worldId')).all<TemplateRow>();
  return c.json({ items: rows.results.map(presentTemplate) });
});

bestiaryRoutes.post('/worlds/:worldId/templates', async (c) => {
  await ownedWorld(c,c.req.param('worldId'));
  const input = await readJson(c,creatureStatTemplateInputSchema);
  const id=crypto.randomUUID(),now=nowIso();
  try {
    await c.env.DB.prepare(`INSERT INTO creature_stat_templates (id,owner_user_id,world_id,name,description,field_definitions,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(id,c.get('user').id,c.req.param('worldId'),input.name,input.description,JSON.stringify(input.fields),now,now).run();
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE')) throw new ApiError(409,'DUPLICATE_TEMPLATE','Já existe um modelo com este nome no World.');
    throw cause;
  }
  return c.json({ id },201);
});

bestiaryRoutes.patch('/templates/:id', async (c) => {
  await ownedTemplate(c,c.req.param('id'));
  const input:CreatureStatTemplateInput=await readJson(c,creatureStatTemplateInputSchema);
  const blocks=await c.env.DB.prepare('SELECT values_json FROM creature_stat_blocks WHERE template_id=?').bind(c.req.param('id')).all<{values_json:string}>();
  const keys=new Set(input.fields.map((field)=>field.key));
  if(blocks.results.some((block)=>Object.keys(JSON.parse(block.values_json) as Record<string,unknown>).some((key)=>!keys.has(key)))) {
    throw new ApiError(409,'TEMPLATE_FIELDS_IN_USE','Remova os valores dos campos excluídos antes de alterar o modelo.');
  }
  try {
    await c.env.DB.prepare('UPDATE creature_stat_templates SET name=?,description=?,field_definitions=?,updated_at=? WHERE id=? AND owner_user_id=?')
      .bind(input.name,input.description,JSON.stringify(input.fields),nowIso(),c.req.param('id'),c.get('user').id).run();
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('UNIQUE')) throw new ApiError(409,'DUPLICATE_TEMPLATE','Já existe um modelo com este nome no World.');
    throw cause;
  }
  return c.json({ success:true });
});

bestiaryRoutes.delete('/templates/:id', async (c) => {
  await ownedTemplate(c,c.req.param('id'));
  const usage=await c.env.DB.prepare('SELECT COUNT(*) total FROM creature_stat_blocks WHERE template_id=?').bind(c.req.param('id')).first<{total:number}>();
  if(Number(usage?.total))throw new ApiError(409,'TEMPLATE_IN_USE','O modelo está em uso por uma ou mais criaturas.');
  await c.env.DB.prepare('DELETE FROM creature_stat_templates WHERE id=? AND owner_user_id=?').bind(c.req.param('id'),c.get('user').id).run();
  return c.body(null,204);
});
