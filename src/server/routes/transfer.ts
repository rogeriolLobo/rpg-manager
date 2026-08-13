import { Hono } from 'hono';
import { z } from 'zod';
import { campaignInputSchema, rpgInputSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';
import { hashSecret } from '../security/crypto';

export const transferRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const previewSchema = z.strictObject({ csv: z.string().min(1).max(500_000) });
const confirmSchema = z.strictObject({ jobId: z.string().uuid() });

function parseCsv(input: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') { row.push(cell.replace(/\r$/u, '')); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  row.push(cell.replace(/\r$/u, '')); if (row.some(Boolean)) rows.push(row); return rows;
}

const normalize = (value: string) => value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const booleanValue = (value: string) => ['true','sim','yes','1'].includes(normalize(value));
const readingMap: Record<string,string> = { 'nao iniciado':'NOT_STARTED','lendo':'READING','lido':'READ' };
const priorityMap: Record<string,string> = { '':'NONE','baixa':'LOW','media':'MEDIUM','alta':'HIGH' };
const tableMap: Record<string,string> = { '':'IDEA','ideia':'IDEA','preparando':'PREPARING','agendado':'SCHEDULED','jogando':'PLAYING','concluido':'COMPLETED' };
const campaignStatusMap: Record<string,string> = { 'planejando':'PLANNING','sessao zero':'SESSION_ZERO','preparando':'PREPARING','em andamento':'IN_PROGRESS','pausada':'PAUSED','concluida':'COMPLETED' };
const frequencyMap: Record<string,string|null> = { '':null,'semanal':'WEEKLY','quinzenal':'BIWEEKLY','mensal':'MONTHLY','bimestral':'BIMONTHLY','irregular':'IRREGULAR' };

function dateValue(value: string): string | null | undefined {
  const text=value.trim();if(!text)return null;if(/^\d{4}-\d{2}-\d{2}$/u.test(text))return z.iso.date().safeParse(text).success?text:undefined;
  const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(text);if(!match)return undefined;
  const iso=`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;return z.iso.date().safeParse(iso).success?iso:undefined;
}

transferRoutes.post('/import/preview', async (c) => {
  const { csv } = await readJson(c, previewSchema); const rows = parseCsv(csv);
  if (rows.length < 2) throw new ApiError(422,'EMPTY_IMPORT','O CSV não contém registros.');
  const headers = rows[0].map(normalize); const required = ['sistema / jogo','categoria','subgenero','status da leitura'];
  const missing = required.filter((header) => !headers.includes(header)); if (missing.length) throw new ApiError(422,'INVALID_COLUMNS','Colunas obrigatórias ausentes.',{missing});
  const index = (name:string) => headers.indexOf(name); const [categories,subgenres] = await c.env.DB.batch([c.env.DB.prepare('SELECT id,name FROM categories'),c.env.DB.prepare('SELECT id,category_id,name FROM subgenres')]);
  const categoryRows = categories.results as Array<{id:string;name:string}>;
  const subgenreRows = subgenres.results as Array<{id:string;category_id:string;name:string}>;
  const categoryMap = new Map(categoryRows.map((item) => [normalize(item.name),item.id]));
  const subgenreMap = new Map(subgenreRows.map((item) => [`${item.category_id}:${normalize(item.name)}`,item.id]));
  const issues: Array<{row:number;message:string}> = []; const items: unknown[]=[];
  for (const [offset,cells] of rows.slice(1).entries()) { if (!cells.some((cell)=>cell.trim())) continue; const title=cells[index('sistema / jogo')]?.trim()??''; const categoryId=categoryMap.get(normalize(cells[index('categoria')]??''))??null;
    const subgenreId=categoryId?subgenreMap.get(`${categoryId}:${normalize(cells[index('subgenero')]??'')}`)??null:null; const readingStatus=readingMap[normalize(cells[index('status da leitura')]??'')];
    if(!title)issues.push({row:offset+2,message:'Título ausente.'}); if(!categoryId)issues.push({row:offset+2,message:'Categoria desconhecida.'}); if(!readingStatus)issues.push({row:offset+2,message:'Status de leitura inválido.'});
    const plannedPlayDate=dateValue(cells[index('quando jogar')]??'');if(plannedPlayDate===undefined)issues.push({row:offset+2,message:'Data de jogo inválida.'});
    const candidate={title,categoryId,subgenreId,readingStatus:readingStatus??'NOT_STARTED',hasPlayed:booleanValue(cells[index('ja joguei?')]??''),wantsToPlay:booleanValue(cells[index('quero jogar?')]??''),priority:priorityMap[normalize(cells[index('prioridade')]??'')]??'NONE',playGroupNotes:(cells[index('grupo / jogadores')]??'').trim(),playGroupId:null,plannedPlayDate:plannedPlayDate??null,tableStatus:tableMap[normalize(cells[index('status da mesa')]??'')]??'IDEA',gameMaster:(cells[index('mestre')]??'').trim(),notes:(cells[index('observacoes')]??'').trim(),coverUrl:null};
    const parsed=rpgInputSchema.safeParse(candidate);if(!parsed.success)issues.push({row:offset+2,message:'Campos fora dos limites permitidos.'});else items.push(parsed.data);
  }
  if(items.length>40)throw new ApiError(422,'IMPORT_BATCH_LIMIT','A V1 importa até 40 registros por arquivo para respeitar o limite transacional do plano gratuito.');
  const payload=JSON.stringify(items);const payloadHash=await hashSecret(`RPG_CATALOG:${payload}`,c.env.PASSWORD_PEPPER);const existing=await c.env.DB.prepare("SELECT id FROM import_jobs WHERE user_id=? AND payload_hash=? AND kind='RPG_CATALOG' AND confirmed_at IS NULL AND expires_at>?").bind(c.get('user').id,payloadHash,nowIso()).first<{id:string}>();
  const jobId=existing?.id??crypto.randomUUID();if(!existing)await c.env.DB.prepare('INSERT INTO import_jobs (id,user_id,payload_hash,normalized_payload,row_count,expires_at,kind) VALUES (?,?,?,?,?,?,?)').bind(jobId,c.get('user').id,payloadHash,payload,items.length,new Date(Date.now()+30*60_000).toISOString(),'RPG_CATALOG').run();
  return c.json({jobId,count:items.length,issues,items:items.slice(0,10),canConfirm:issues.length===0&&items.length>0});
});

transferRoutes.post('/import/confirm',async(c)=>{const {jobId}=await readJson(c,confirmSchema);const user=c.get('user');const job=await c.env.DB.prepare("SELECT normalized_payload FROM import_jobs WHERE id=? AND user_id=? AND kind='RPG_CATALOG' AND confirmed_at IS NULL AND expires_at>?").bind(jobId,user.id,nowIso()).first<{normalized_payload:string}>();if(!job)throw new ApiError(404,'IMPORT_JOB_NOT_FOUND','Prévia expirada ou já confirmada.');
  const items=z.array(rpgInputSchema).parse(JSON.parse(job.normalized_payload));const now=nowIso();const statements:D1PreparedStatement[]=[];for(const item of items)statements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO rpgs (id,user_id,title,category_id,subgenre_id,reading_status,has_played,wants_to_play,priority,play_group_notes,planned_play_date,table_status,game_master,notes,cover_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.id,item.title,item.categoryId??null,item.subgenreId??null,item.readingStatus,Number(item.hasPlayed),Number(item.wantsToPlay),item.priority,item.playGroupNotes,item.plannedPlayDate??null,item.tableStatus,item.gameMaster,item.notes,item.coverUrl??null,now,now));statements.push(c.env.DB.prepare('UPDATE import_jobs SET confirmed_at=? WHERE id=? AND user_id=?').bind(now,jobId,user.id));const results=await c.env.DB.batch(statements);const imported=results.slice(0,-1).reduce((sum,result)=>sum+Number(result.meta.changes??0),0);return c.json({imported,skipped:items.length-imported});});

const campaignImportItemSchema=z.object({input:campaignInputSchema,lastSessionDate:z.iso.date().nullable(),legacySessionsCompleted:z.number().int().nonnegative()});
transferRoutes.post('/import/campaigns/preview',async(c)=>{const {csv}=await readJson(c,previewSchema);const rows=parseCsv(csv);if(rows.length<2)throw new ApiError(422,'EMPTY_IMPORT','O CSV não contém registros.');
  const headers=rows[0].map(normalize);const required=['campanha','rpg / sistema','status'];const missing=required.filter((header)=>!headers.includes(header));if(missing.length)throw new ApiError(422,'INVALID_COLUMNS','Colunas obrigatórias ausentes.',{missing});const index=(name:string)=>headers.indexOf(name);
  const rpgRows=await c.env.DB.prepare('SELECT id,title FROM rpgs WHERE user_id=?').bind(c.get('user').id).all<{id:string;title:string}>();const rpgMap=new Map(rpgRows.results.map((item)=>[normalize(item.title),item]));const issues:Array<{row:number;message:string}>=[];const items:unknown[]=[];
  for(const [offset,cells] of rows.slice(1).entries()){if(!cells.some((cell)=>cell.trim()))continue;const row=offset+2;const name=(cells[index('campanha')]??'').trim();const rpgTitle=(cells[index('rpg / sistema')]??'').trim();const rpg=rpgMap.get(normalize(rpgTitle));const status=campaignStatusMap[normalize(cells[index('status')]??'')];const frequency=frequencyMap[normalize(cells[index('frequencia')]??'')];
    const sessionZeroDate=dateValue(cells[index('sessao zero')]??'');const firstSessionDate=dateValue(cells[index('primeira sessao')]??'');const nextSessionDate=dateValue(cells[index('proxima sessao')]??'');const lastSessionDate=dateValue(cells[index('ultima sessao')]??'');
    if(!name)issues.push({row,message:'Nome da campanha ausente.'});if(!rpg)issues.push({row,message:'RPG não encontrado no catálogo importado.'});if(!status)issues.push({row,message:'Status da campanha inválido.'});if(frequency===undefined)issues.push({row,message:'Frequência inválida.'});if([sessionZeroDate,firstSessionDate,nextSessionDate,lastSessionDate].includes(undefined))issues.push({row,message:'Uma das datas é inválida.'});
    const sessionGoalText=(cells[index('meta de sessoes')]??'').trim();const completedText=(cells[index('sessoes realizadas')]??'').trim();const sessionGoal=sessionGoalText?Number(sessionGoalText):null;const legacySessionsCompleted=completedText?Number(completedText):0;
    const input={rpgId:rpg?.id??'',name,status:status??'PLANNING',gameMaster:(cells[index('mestre')]??'').trim(),playGroupId:null,sessionZeroDate:sessionZeroDate??null,firstSessionDate:firstSessionDate??null,frequency:frequency??null,nextSessionDate:nextSessionDate??null,sessionGoal:Number.isInteger(sessionGoal)&&Number(sessionGoal)>0?sessionGoal:null,legacyMembersText:(cells[index('grupo / jogadores')]??'').trim(),legacyCharactersText:(cells[index('personagens')]??'').trim(),notes:(cells[index('observacoes')]??'').trim()};
    if(sessionGoalText&&input.sessionGoal===null)issues.push({row,message:'Meta de sessões inválida.'});if(!Number.isInteger(legacySessionsCompleted)||legacySessionsCompleted<0)issues.push({row,message:'Quantidade de sessões inválida.'});const parsed=campaignInputSchema.safeParse(input);if(!parsed.success)issues.push({row,message:'Campos fora dos limites permitidos.'});else if(name&&rpg&&status&&frequency!==undefined&&![sessionZeroDate,firstSessionDate,nextSessionDate,lastSessionDate].includes(undefined)&&Number.isInteger(legacySessionsCompleted)&&legacySessionsCompleted>=0)items.push({input:parsed.data,lastSessionDate:lastSessionDate??null,legacySessionsCompleted});
  }
  if(items.length>40)throw new ApiError(422,'IMPORT_BATCH_LIMIT','A V1 importa até 40 campanhas por arquivo.');const payload=JSON.stringify(items);const payloadHash=await hashSecret(`CAMPAIGNS:${payload}`,c.env.PASSWORD_PEPPER);const existing=await c.env.DB.prepare("SELECT id FROM import_jobs WHERE user_id=? AND payload_hash=? AND kind='CAMPAIGNS' AND confirmed_at IS NULL AND expires_at>?").bind(c.get('user').id,payloadHash,nowIso()).first<{id:string}>();const jobId=existing?.id??crypto.randomUUID();if(!existing)await c.env.DB.prepare('INSERT INTO import_jobs (id,user_id,payload_hash,normalized_payload,row_count,expires_at,kind) VALUES (?,?,?,?,?,?,?)').bind(jobId,c.get('user').id,payloadHash,payload,items.length,new Date(Date.now()+30*60_000).toISOString(),'CAMPAIGNS').run();
  return c.json({jobId,count:items.length,issues,items:(items as Array<{input:{name:string;rpgId:string}}>).slice(0,10).map((item)=>({title:item.input.name})),canConfirm:issues.length===0&&items.length>0});});

transferRoutes.post('/import/campaigns/confirm',async(c)=>{const {jobId}=await readJson(c,confirmSchema);const user=c.get('user');const job=await c.env.DB.prepare("SELECT normalized_payload FROM import_jobs WHERE id=? AND user_id=? AND kind='CAMPAIGNS' AND confirmed_at IS NULL AND expires_at>?").bind(jobId,user.id,nowIso()).first<{normalized_payload:string}>();if(!job)throw new ApiError(404,'IMPORT_JOB_NOT_FOUND','Prévia expirada ou já confirmada.');const items=z.array(campaignImportItemSchema).parse(JSON.parse(job.normalized_payload));const now=nowIso();const statements:D1PreparedStatement[]=[];
  for(const {input,lastSessionDate,legacySessionsCompleted} of items)statements.push(c.env.DB.prepare(`INSERT INTO campaigns (id,user_id,rpg_id,name,status,game_master,session_zero_date,first_session_date,frequency,next_session_date,last_session_date,session_goal,play_group_id,legacy_members_text,legacy_characters_text,legacy_sessions_completed,notes,created_at,updated_at,completed_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE user_id=? AND rpg_id=? AND name=?)`).bind(crypto.randomUUID(),user.id,input.rpgId,input.name,input.status,input.gameMaster,input.sessionZeroDate??null,input.firstSessionDate??null,input.frequency??null,input.nextSessionDate??null,lastSessionDate,input.sessionGoal??null,null,input.legacyMembersText,input.legacyCharactersText,legacySessionsCompleted,input.notes,now,now,input.status==='COMPLETED'?now:null,user.id,input.rpgId,input.name));
  statements.push(c.env.DB.prepare('UPDATE import_jobs SET confirmed_at=? WHERE id=? AND user_id=?').bind(now,jobId,user.id));const results=await c.env.DB.batch(statements);const imported=results.slice(0,-1).reduce((sum,result)=>sum+Number(result.meta.changes??0),0);return c.json({imported,skipped:items.length-imported});});

function csvEscape(value: unknown): string { const text=String(value??''); return /[",\n]/u.test(text)?`"${text.replaceAll('"','""')}"`:text; }
transferRoutes.get('/export',async(c)=>{const user=c.get('user');const format=c.req.query('format')??'json';if(format==='csv'){const rows=await c.env.DB.prepare(`SELECT r.title,c.name category,s.name subgenre,r.reading_status,r.has_played,r.wants_to_play,r.priority,COALESCE(g.name,r.play_group_notes) play_group,r.planned_play_date,r.table_status,r.game_master,r.notes,r.cover_url FROM rpgs r LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN subgenres s ON s.id=r.subgenre_id LEFT JOIN play_groups g ON g.id=r.play_group_id WHERE r.user_id=? ORDER BY r.title`).bind(user.id).all();const headers=['title','category','subgenre','reading_status','has_played','wants_to_play','priority','play_group','planned_play_date','table_status','game_master','notes','cover_url'];const csv=[headers.join(','),...rows.results.map((row)=>headers.map((key)=>csvEscape(row[key])).join(','))].join('\n');return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="rpg-manager-catalogo.csv"'}});}const [rpgs,campaigns,members,sessions,attendance,groups,groupMembers,preferences]=await c.env.DB.batch([c.env.DB.prepare('SELECT * FROM rpgs WHERE user_id=?').bind(user.id),c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id=?').bind(user.id),c.env.DB.prepare('SELECT m.* FROM campaign_members m JOIN campaigns c ON c.id=m.campaign_id WHERE c.user_id=?').bind(user.id),c.env.DB.prepare('SELECT s.* FROM campaign_sessions s JOIN campaigns c ON c.id=s.campaign_id WHERE c.user_id=?').bind(user.id),c.env.DB.prepare('SELECT a.* FROM campaign_session_attendance a JOIN campaign_sessions s ON s.id=a.session_id JOIN campaigns c ON c.id=s.campaign_id WHERE c.user_id=?').bind(user.id),c.env.DB.prepare('SELECT * FROM play_groups WHERE user_id=?').bind(user.id),c.env.DB.prepare('SELECT m.* FROM play_group_members m JOIN play_groups g ON g.id=m.group_id WHERE g.user_id=?').bind(user.id),c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id=?').bind(user.id)]);return c.json({exportedAt:nowIso(),version:2,user:{email:user.email,displayName:user.displayName},data:{rpgs:rpgs.results,campaigns:campaigns.results,members:members.results,sessions:sessions.results,attendance:attendance.results,groups:groups.results,groupMembers:groupMembers.results,preferences:preferences.results}});});
