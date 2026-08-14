import { Hono } from 'hono';
import { z } from 'zod';
import { campaignInputSchema, rpgInputSchema } from '../../shared/validation/schemas';
import { ApiError, nowIso, readJson } from '../http';
import type { AppVariables, Env } from '../types';
import { hashSecret } from '../security/crypto';
import { validateRemoteCoverImage } from '../security/cover-images';
import { isAllowedCoverUrl, isPublicHttpsUrl } from '../../shared/security/cover-url';

export const transferRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const previewSchema = z.strictObject({ csv: z.string().min(1).max(500_000) });
const confirmSchema = z.strictObject({ jobId: z.string().uuid() });
const catalogConfirmSchema = z.strictObject({
  jobId: z.string().uuid(),
  approvedRows: z.array(z.number().int().min(2)).min(1).max(40),
});

const catalogPlanItemSchema = z.strictObject({
  row: z.number().int().min(2),
  title: z.string().max(160),
  classification: z.enum(['NOVO', 'ATUALIZACAO', 'IGNORADO', 'ERRO']),
  message: z.string().max(500),
  existingId: z.string().nullable(),
  currentCoverUrl: z.string().nullable(),
  incomingCoverUrl: z.string().nullable(),
  changes: z.array(z.enum(['coverUrl', 'isbn', 'coverSourceUrl', 'coverSourceNote'])),
  input: rpgInputSchema.nullable(),
});
const catalogPlanSchema = z.array(catalogPlanItemSchema).max(40);
type CatalogPlanItem = z.infer<typeof catalogPlanItemSchema>;

interface ExistingCatalogRpg {
  id: string;
  title: string;
  cover_url: string | null;
}

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
const normalizeTitle = (value: string) => value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
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

function findHeader(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const position = headers.indexOf(alias);
    if (position >= 0) return position;
  }
  return -1;
}

function mapExistingRpgs(rows: ExistingCatalogRpg[]): Map<string, ExistingCatalogRpg[]> {
  const result = new Map<string, ExistingCatalogRpg[]>();
  for (const item of rows) {
    const key = normalizeTitle(item.title);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

transferRoutes.post('/import/preview', async (c) => {
  const { csv } = await readJson(c, previewSchema); const rows = parseCsv(csv);
  if (rows.length < 2) throw new ApiError(422,'EMPTY_IMPORT','O CSV não contém registros.');
  const headers = rows[0].map(normalize); const required = ['sistema / jogo','categoria','subgenero','status da leitura'];
  const missing = required.filter((header) => !headers.includes(header)); if (missing.length) throw new ApiError(422,'INVALID_COLUMNS','Colunas obrigatórias ausentes.',{missing});
  const index = (name:string) => headers.indexOf(name);
  const coverIndex = findHeader(headers, ['capa url', 'cover_url', 'cover url']);
  const isbnIndex = findHeader(headers, ['isbn']);
  const coverSourceIndex = findHeader(headers, ['fonte da capa', 'cover_source_url']);
  const coverNoteIndex = findHeader(headers, ['nota da capa', 'cover_source_note']);
  const [categories,subgenres,existingRpgs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id,name FROM categories'),
    c.env.DB.prepare('SELECT id,category_id,name FROM subgenres'),
    c.env.DB.prepare('SELECT id,title,cover_url FROM rpgs WHERE user_id=?').bind(c.get('user').id),
  ]);
  const categoryRows = categories.results as Array<{id:string;name:string}>;
  const subgenreRows = subgenres.results as Array<{id:string;category_id:string;name:string}>;
  const categoryMap = new Map(categoryRows.map((item) => [normalize(item.name),item.id]));
  const subgenreMap = new Map(subgenreRows.map((item) => [`${item.category_id}:${normalize(item.name)}`,item.id]));
  const existingMap = mapExistingRpgs(existingRpgs.results as unknown as ExistingCatalogRpg[]);
  const dataRows = rows.slice(1).map((cells, offset) => ({ cells, row: offset + 2 })).filter(({ cells }) => cells.some((cell) => cell.trim()));
  if(dataRows.length>40)throw new ApiError(422,'IMPORT_BATCH_LIMIT','A V1 importa até 40 registros por arquivo para respeitar o limite transacional do plano gratuito.');
  const titleCounts = new Map<string, number>();
  for (const { cells } of dataRows) {
    const key = normalizeTitle(cells[index('sistema / jogo')] ?? '');
    if (key) titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  const items: CatalogPlanItem[]=[];
  for (const { cells, row } of dataRows) { const title=cells[index('sistema / jogo')]?.trim()??''; const categoryId=categoryMap.get(normalize(cells[index('categoria')]??''))??null;
    const subgenreId=categoryId?subgenreMap.get(`${categoryId}:${normalize(cells[index('subgenero')]??'')}`)??null:null; const readingStatus=readingMap[normalize(cells[index('status da leitura')]??'')];
    const rowIssues: string[]=[];
    if(!title)rowIssues.push('Título ausente.'); if(!categoryId)rowIssues.push('Categoria desconhecida.'); if(!readingStatus)rowIssues.push('Status de leitura inválido.');
    const plannedPlayDate=dateValue(cells[index('quando jogar')]??'');if(plannedPlayDate===undefined)rowIssues.push('Data de jogo inválida.');
    const coverUrl=(coverIndex>=0?cells[coverIndex]:'')?.trim()||null;
    const isbn=(isbnIndex>=0?cells[isbnIndex]:'')?.trim()||null;
    const coverSourceUrl=(coverSourceIndex>=0?cells[coverSourceIndex]:'')?.trim()||null;
    const coverSourceNote=(coverNoteIndex>=0?cells[coverNoteIndex]:'')?.trim()||null;
    if(coverSourceUrl&&!isPublicHttpsUrl(coverSourceUrl))rowIssues.push('Fonte da capa inválida: use uma URL HTTPS pública.');
    const key=normalizeTitle(title);const matches=existingMap.get(key)??[];
    if(key&&(titleCounts.get(key)??0)>1)rowIssues.push('Título repetido no CSV; revisão manual necessária.');
    if(matches.length>1)rowIssues.push('Mais de um RPG existente corresponde ao título normalizado; revisão manual necessária.');
    const existing=matches.length===1?matches[0]:null;
    // A allowlist de hosts só se aplica quando a capa do CSV for de fato usada para gravar um
    // valor NOVO (RPG novo, ou existente ainda sem capa). Se o RPG já tem capa própria, a linha
    // será IGNORADA/preservada — não faz sentido reprovar o CSV por uma capa que nem será escrita.
    if(coverUrl&&(!existing||!existing.cover_url)&&!isAllowedCoverUrl(coverUrl))rowIssues.push('CAPA INVÁLIDA: use HTTPS e um domínio de imagens autorizado.');
    const candidate={title,categoryId,subgenreId,readingStatus:readingStatus??'NOT_STARTED',hasPlayed:booleanValue(cells[index('ja joguei?')]??''),wantsToPlay:booleanValue(cells[index('quero jogar?')]??''),priority:priorityMap[normalize(cells[index('prioridade')]??'')]??'NONE',playGroupNotes:(cells[index('grupo / jogadores')]??'').trim(),playGroupId:null,plannedPlayDate:plannedPlayDate??null,tableStatus:tableMap[normalize(cells[index('status da mesa')]??'')]??'IDEA',gameMaster:(cells[index('mestre')]??'').trim(),notes:(cells[index('observacoes')]??'').trim(),coverUrl,isbn,coverSourceUrl,coverSourceNote};
    const parsed=rpgInputSchema.safeParse(candidate);if(!parsed.success&&!rowIssues.length)rowIssues.push('Campos fora dos limites permitidos.');
    if(!rowIssues.length&&coverUrl&&(!existing||!existing.cover_url)){
      const remoteValidation=await validateRemoteCoverImage(coverUrl);
      if(!remoteValidation.ok)rowIssues.push(`CAPA INVÁLIDA: ${remoteValidation.message}`);
    }
    if(rowIssues.length||!parsed.success){items.push({row,title,classification:'ERRO',message:rowIssues.join(' '),existingId:existing?.id??null,currentCoverUrl:existing?.cover_url??null,incomingCoverUrl:coverUrl,changes:[],input:null});continue;}
    if(!existing){items.push({row,title,classification:'NOVO',message:'Novo RPG pronto para importação.',existingId:null,currentCoverUrl:null,incomingCoverUrl:coverUrl,changes:coverUrl?['coverUrl','isbn','coverSourceUrl','coverSourceNote']:[],input:parsed.data});continue;}
    if(existing.cover_url){items.push({row,title,classification:'IGNORADO',message:existing.cover_url===coverUrl?'O RPG já possui esta capa; nenhuma alteração necessária.':'O RPG já possui capa; a capa existente será preservada.',existingId:existing.id,currentCoverUrl:existing.cover_url,incomingCoverUrl:coverUrl,changes:[],input:parsed.data});continue;}
    if(!coverUrl){items.push({row,title,classification:'IGNORADO',message:'O RPG já existe e o CSV não fornece uma capa.',existingId:existing.id,currentCoverUrl:null,incomingCoverUrl:null,changes:[],input:parsed.data});continue;}
    items.push({row,title,classification:'ATUALIZACAO',message:'Somente os campos de capa serão atualizados.',existingId:existing.id,currentCoverUrl:null,incomingCoverUrl:coverUrl,changes:['coverUrl','isbn','coverSourceUrl','coverSourceNote'],input:parsed.data});
  }
  const payload=JSON.stringify(items);const payloadHash=await hashSecret(`RPG_CATALOG:${payload}`,c.env.PASSWORD_PEPPER);const existing=await c.env.DB.prepare("SELECT id FROM import_jobs WHERE user_id=? AND payload_hash=? AND kind='RPG_CATALOG' AND confirmed_at IS NULL AND expires_at>?").bind(c.get('user').id,payloadHash,nowIso()).first<{id:string}>();
  const jobId=existing?.id??crypto.randomUUID();if(!existing)await c.env.DB.prepare('INSERT INTO import_jobs (id,user_id,payload_hash,normalized_payload,row_count,expires_at,kind) VALUES (?,?,?,?,?,?,?)').bind(jobId,c.get('user').id,payloadHash,payload,items.length,new Date(Date.now()+30*60_000).toISOString(),'RPG_CATALOG').run();
  const issues=items.filter((item)=>item.classification==='ERRO').map((item)=>({row:item.row,message:item.message}));
  const summary=items.reduce<Record<string,number>>((result,item)=>({...result,[item.classification]:(result[item.classification]??0)+1}),{NOVO:0,ATUALIZACAO:0,IGNORADO:0,ERRO:0});
  return c.json({jobId,count:items.length,issues,items,summary,canConfirm:items.some((item)=>item.classification==='NOVO'||item.classification==='ATUALIZACAO')});
});

transferRoutes.post('/import/confirm',async(c)=>{const {jobId,approvedRows}=await readJson(c,catalogConfirmSchema);const user=c.get('user');const job=await c.env.DB.prepare("SELECT normalized_payload FROM import_jobs WHERE id=? AND user_id=? AND kind='RPG_CATALOG' AND confirmed_at IS NULL AND expires_at>?").bind(jobId,user.id,nowIso()).first<{normalized_payload:string}>();if(!job)throw new ApiError(404,'IMPORT_JOB_NOT_FOUND','Prévia expirada ou já confirmada.');
  const items=catalogPlanSchema.parse(JSON.parse(job.normalized_payload));const approvedSet=new Set(approvedRows);if(approvedSet.size!==approvedRows.length)throw new ApiError(422,'INVALID_IMPORT_SELECTION','A seleção contém linhas repetidas.');
  const selected=items.filter((item)=>approvedSet.has(item.row));if(selected.length!==approvedSet.size||selected.some((item)=>!['NOVO','ATUALIZACAO'].includes(item.classification)||!item.input))throw new ApiError(422,'INVALID_IMPORT_SELECTION','Selecione apenas linhas novas ou de atualização.');
  const currentRows=await c.env.DB.prepare('SELECT id,title,cover_url FROM rpgs WHERE user_id=?').bind(user.id).all<ExistingCatalogRpg>();const currentMap=mapExistingRpgs(currentRows.results);const now=nowIso();const statements:D1PreparedStatement[]=[];const actions:Array<'NOVO'|'ATUALIZACAO'>=[];
  for(const item of selected){const input=item.input!;if(item.classification==='NOVO'){if((currentMap.get(normalizeTitle(input.title))??[]).length)continue;statements.push(c.env.DB.prepare(`INSERT INTO rpgs (id,user_id,title,category_id,subgenre_id,reading_status,has_played,wants_to_play,priority,play_group_notes,planned_play_date,table_status,game_master,notes,cover_url,isbn,cover_source_url,cover_source_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.id,input.title,input.categoryId??null,input.subgenreId??null,input.readingStatus,Number(input.hasPlayed),Number(input.wantsToPlay),input.priority,input.playGroupNotes,input.plannedPlayDate??null,input.tableStatus,input.gameMaster,input.notes,input.coverUrl??null,input.isbn??null,input.coverSourceUrl??null,input.coverSourceNote??null,now,now));actions.push('NOVO');}
    else{statements.push(c.env.DB.prepare('UPDATE rpgs SET cover_url=?,isbn=?,cover_source_url=?,cover_source_note=?,updated_at=? WHERE id=? AND user_id=? AND cover_url IS NULL').bind(input.coverUrl??null,input.isbn??null,input.coverSourceUrl??null,input.coverSourceNote??null,now,item.existingId,user.id));actions.push('ATUALIZACAO');}}
  statements.push(c.env.DB.prepare('UPDATE import_jobs SET confirmed_at=? WHERE id=? AND user_id=?').bind(now,jobId,user.id));const results=await c.env.DB.batch(statements);let imported=0;let updated=0;for(const [index,action] of actions.entries()){const changes=Number(results[index].meta.changes??0);if(action==='NOVO')imported+=changes;else updated+=changes;}return c.json({imported,updated,skipped:items.length-imported-updated});});

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
transferRoutes.get('/export',async(c)=>{const user=c.get('user');const format=c.req.query('format')??'json';if(format==='csv'){const rows=await c.env.DB.prepare(`SELECT r.title,c.name category,s.name subgenre,r.reading_status,r.has_played,r.wants_to_play,r.priority,COALESCE(g.name,r.play_group_notes) play_group,r.planned_play_date,r.table_status,r.game_master,r.notes,r.cover_url,r.isbn,r.cover_source_url,r.cover_source_note FROM rpgs r LEFT JOIN categories c ON c.id=r.category_id LEFT JOIN subgenres s ON s.id=r.subgenre_id LEFT JOIN play_groups g ON g.id=r.play_group_id WHERE r.user_id=? ORDER BY r.title`).bind(user.id).all();const headers=['title','category','subgenre','reading_status','has_played','wants_to_play','priority','play_group','planned_play_date','table_status','game_master','notes','cover_url','isbn','cover_source_url','cover_source_note'];const csv=[headers.join(','),...rows.results.map((row)=>headers.map((key)=>csvEscape(row[key])).join(','))].join('\n');return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="rpg-manager-catalogo.csv"'}});}
  const [rpgs,campaigns,members,sessions,attendance,groups,groupMembers,preferences,worlds,worldMembers,entities,adventureDetails,campaignEntities]=await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM rpgs WHERE user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT * FROM campaigns WHERE user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT m.* FROM campaign_members m JOIN campaigns c ON c.id=m.campaign_id WHERE c.user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT s.* FROM campaign_sessions s JOIN campaigns c ON c.id=s.campaign_id WHERE c.user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT a.* FROM campaign_session_attendance a JOIN campaign_sessions s ON s.id=a.session_id JOIN campaigns c ON c.id=s.campaign_id WHERE c.user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT * FROM play_groups WHERE user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT m.* FROM play_group_members m JOIN play_groups g ON g.id=m.group_id WHERE g.user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT * FROM user_preferences WHERE user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT * FROM worlds WHERE owner_user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT wm.* FROM world_members wm JOIN worlds w ON w.id=wm.world_id WHERE w.owner_user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT * FROM vault_entities WHERE owner_user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT a.* FROM adventure_details a JOIN vault_entities e ON e.id=a.entity_id WHERE e.owner_user_id=?').bind(user.id),
    c.env.DB.prepare('SELECT ce.* FROM campaign_entities ce JOIN campaigns c ON c.id=ce.campaign_id WHERE c.user_id=?').bind(user.id),
  ]);
  return c.json({exportedAt:nowIso(),version:5,user:{email:user.email,displayName:user.displayName},data:{rpgs:rpgs.results,campaigns:campaigns.results,members:members.results,sessions:sessions.results,attendance:attendance.results,groups:groups.results,groupMembers:groupMembers.results,preferences:preferences.results,worlds:worlds.results,worldMembers:worldMembers.results,entities:entities.results,adventureDetails:adventureDetails.results,campaignEntities:campaignEntities.results}});
});
