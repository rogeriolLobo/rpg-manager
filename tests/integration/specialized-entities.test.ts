import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const worker = exports as unknown as { default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> } };
const origin='https://bestiary.example.com',password='esta e uma senha longa 2026';
let requestSequence=1;
interface Account { userId:string;cookie:string;csrf:string }

async function request(path:string,method='GET',body?:unknown,account?:Account){return worker.default.fetch(`${origin}/api/v1${path}`,{method,headers:{'CF-Connecting-IP':`198.51.100.${requestSequence++%250}`,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:origin}:{}),...(account?{Cookie:account.cookie,'X-CSRF-Token':account.csrf}:{})},body:body!==undefined?JSON.stringify(body):undefined});}
async function register(name:string):Promise<Account>{const response=await request('/auth/register','POST',{email:`${name}@example.com`,displayName:name,password});expect(response.status).toBe(201);const cookies=response.headers.get('set-cookie')??'',session=cookies.match(/rpg_session=([^;,]+)/)?.[1],csrf=cookies.match(/rpg_csrf=([^;,]+)/)?.[1],body=await response.json() as {user:{id:string}};if(!session||!csrf)throw new Error('Cookies ausentes.');return{userId:body.user.id,cookie:`rpg_session=${session}; rpg_csrf=${csrf}`,csrf};}
async function createWorld(owner:Account,name:string){const response=await request('/worlds','POST',{name,description:'',defaultRpgId:null,visibility:'GROUP'},owner);expect(response.status).toBe(201);return(await response.json() as {item:{id:string}}).item.id;}
async function createCampaign(owner:Account,player:Account,gameMaster:Account){const groupResponse=await request('/groups','POST',{name:'Mesa do Bestiário',notes:''},owner),groupId=(await groupResponse.json() as {item:{id:string}}).item.id;for(const [account,isGameMaster] of [[player,false],[gameMaster,true]] as const)expect((await request(`/groups/${groupId}/members`,'POST',{playerName:account.userId,userId:account.userId,notes:'',active:true,isGameMaster},owner)).status).toBe(201);const rpgResponse=await request('/rpgs','POST',{title:'Sistema livre',categoryId:'fantasia',subgenreId:'alta-fantasia',readingStatus:'READING',hasPlayed:false,wantsToPlay:true,priority:'HIGH',playGroupNotes:'',playGroupId:null,plannedPlayDate:null,tableStatus:'IDEA',gameMaster:'',notes:'',coverUrl:null},owner),rpgId=(await rpgResponse.json() as {item:{id:string}}).item.id;const campaignResponse=await request('/campaigns','POST',{rpgId,name:'Campanha do Bestiário',status:'IN_PROGRESS',gameMaster:'',playGroupId:groupId,adventureEntityId:null,sessionZeroDate:null,firstSessionDate:null,frequency:'WEEKLY',nextSessionDate:null,sessionGoal:8,legacyMembersText:'',legacyCharactersText:'',notes:''},owner);return(await campaignResponse.json() as {item:{id:string}}).item.id;}

describe('campos especializados e Bestiário',()=>{
  it('redige notas de narrador para jogadores e preserva acesso do owner e GM',async()=>{
    const owner=await register('specialized-owner'),player=await register('specialized-player'),gm=await register('specialized-gm');
    const worldId=await createWorld(owner,'Aldea especializada'),campaignId=await createCampaign(owner,player,gm);
    const create=await request('/vault','POST',{entityType:'NPC',name:'Conselheira',summary:'',description:'',visibility:'PLAYERS',worldId,groupId:null,parentEntityId:null,adventure:null,lore:null,npc:{role:'Conselheira',occupation:'Diplomata',motivation:'Proteger a cidade',publicNotes:'Ajuda os heróis',gmNotes:'É a traidora'}},owner);
    expect(create.status).toBe(201);const entityId=(await create.json() as {id:string}).id;
    expect((await request(`/campaigns/${campaignId}/entities/${entityId}`,'POST',{usageType:'REFERENCE'},owner)).status).toBe(201);
    const playerItem=(await (await request(`/vault/${entityId}`,'GET',undefined,player)).json() as {item:{npc:Record<string,unknown>}}).item;
    const gmItem=(await (await request(`/vault/${entityId}`,'GET',undefined,gm)).json() as {item:{npc:Record<string,unknown>}}).item;
    const ownerItem=(await (await request(`/vault/${entityId}`,'GET',undefined,owner)).json() as {item:{npc:Record<string,unknown>}}).item;
    expect(playerItem.npc).not.toHaveProperty('gmNotes');
    expect(gmItem.npc.gmNotes).toBe('É a traidora');
    expect(ownerItem.npc.gmNotes).toBe('É a traidora');
  });

  it('usa modelos configuráveis de estatísticas e bloqueia campos ou Worlds incompatíveis',async()=>{
    const owner=await register('template-owner'),outsider=await register('template-outsider');
    const worldId=await createWorld(owner,'Bestiário livre'),otherWorldId=await createWorld(owner,'Outro Bestiário');
    const templateResponse=await request(`/bestiary/worlds/${worldId}/templates`,'POST',{name:'Ficha narrativa',description:'Sem sistema obrigatório',fields:[{key:'ameaca',label:'Ameaça',type:'NUMBER',required:true},{key:'habito',label:'Hábito marcante',type:'TEXT',required:false}]},owner);
    expect(templateResponse.status).toBe(201);const templateId=(await templateResponse.json() as {id:string}).id;
    expect((await request(`/bestiary/templates/${templateId}`,'PATCH',{name:'Invadida',description:'',fields:[]},outsider)).status).toBe(404);
    const base={entityType:'CREATURE',name:'Corvo de cinzas',summary:'',description:'',visibility:'PRIVATE',worldId,groupId:null,parentEntityId:null,adventure:null,lore:null};
    expect((await request('/vault','POST',{...base,creature:{classification:'Espírito',habitat:'Ruínas',behavior:'Observador',dangerNotes:'Evitar ao anoitecer',statBlock:{templateId,values:{ameaca:'alta'}}}},owner)).status).toBe(422);
    expect((await request('/vault','POST',{...base,worldId:otherWorldId,creature:{classification:'Espírito',habitat:'',behavior:'',dangerNotes:'',statBlock:{templateId,values:{ameaca:3}}}},owner)).status).toBe(422);
    const valid=await request('/vault','POST',{...base,creature:{classification:'Espírito',habitat:'Ruínas',behavior:'Observador',dangerNotes:'Evitar ao anoitecer',statBlock:{templateId,values:{ameaca:3,habito:'Coleciona sinos'}}}},owner);
    expect(valid.status).toBe(201);const entityId=(await valid.json() as {id:string}).id;
    const item=(await (await request(`/vault/${entityId}`,'GET',undefined,owner)).json() as {item:{creature:{statBlock:{templateName:string;values:Record<string,unknown>}}}}).item;
    expect(item.creature.statBlock).toEqual(expect.objectContaining({templateName:'Ficha narrativa',values:{ameaca:3,habito:'Coleciona sinos'}}));
    expect((await request(`/bestiary/templates/${templateId}`,'DELETE',undefined,owner)).status).toBe(409);
  });
});
