import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/server/types";

const worker = exports as unknown as {
  default: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
};
const origin = "https://example.com";
const testEnv = env as unknown as Env;
let requestSequence = 1;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookies?: string,
  csrf?: string,
) {
  return worker.default.fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      "CF-Connecting-IP": `192.0.2.${requestSequence++ % 250}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: origin } : {}),
      ...(cookies ? { Cookie: cookies } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function authCookies(response: Response) {
  const value = response.headers.get("set-cookie") ?? "";
  const session = value.match(/rpg_session=([^;,]+)/)?.[1];
  const csrf = value.match(/rpg_csrf=([^;,]+)/)?.[1];
  if (!session || !csrf) throw new Error(`Cookies ausentes: ${value}`);
  return { cookie: `rpg_session=${session}; rpg_csrf=${csrf}`, csrf };
}
async function register(email: string) {
  const response = await request("/auth/register", "POST", {
    email,
    displayName: email.split("@")[0],
    password: "esta e uma senha longa 2026",
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { user:{id:string;displayName:string};recoveryCodes: string[] };
  return { ...authCookies(response), user:body.user, recoveryCodes: body.recoveryCodes };
}
const rpg = {
  title: "Blue Rose",
  categoryId: "fantasia",
  subgenreId: "alta-fantasia",
  readingStatus: "READING",
  hasPlayed: false,
  wantsToPlay: true,
  priority: "HIGH",
  playGroupNotes: "Grupo",
  plannedPlayDate: null,
  tableStatus: "IDEA",
  gameMaster: "Rogério",
  notes: "<script>alert(1)</script>",
  coverUrl: null,
};
const campaign = {
  name: "A Coroa Azul",
  status: "PREPARING",
  gameMaster: "Rogério",
  sessionZeroDate: null,
  firstSessionDate: null,
  frequency: "BIWEEKLY",
  nextSessionDate: null,
  sessionGoal: 12,
  legacyMembersText: "",
  notes: "Campanha isolada por proprietário.",
};
describe("API real com D1", () => {
  it('persiste preferência de tema por conta e rejeita valores inválidos', async () => {
    const first = await register('theme-first@example.com');
    const second = await register('theme-second@example.com');
    const initial = await request('/preferences', 'GET', undefined, first.cookie);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({theme:'SYSTEM'});
    const updated = await request('/preferences', 'PATCH', {theme:'DARK'}, first.cookie, first.csrf);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({theme:'DARK'});
    expect(await (await request('/preferences', 'GET', undefined, first.cookie)).json()).toEqual({theme:'DARK'});
    expect(await (await request('/preferences', 'GET', undefined, second.cookie)).json()).toEqual({theme:'SYSTEM'});
    expect((await request('/preferences', 'PATCH', {theme:'SEPIA'}, first.cookie, first.csrf)).status).toBe(422);
  });

  it("registra, autentica, persiste hash e recupera com código de uso único", async () => {
    const account = await register("auth@example.com");
    const session = await request(
      "/auth/session",
      "GET",
      undefined,
      account.cookie,
    );
    expect(session.status).toBe(200);
    const recovery = await request("/auth/recover", "POST", {
      email: "auth@example.com",
      recoveryCode: account.recoveryCodes[0],
      newPassword: "uma nova senha longa 2026",
    });
    expect(recovery.status).toBe(200);
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);
    const reused = await request("/auth/recover", "POST", {
      email: "auth@example.com",
      recoveryCode: account.recoveryCodes[0],
      newPassword: "outra senha longa 2026",
    });
    expect(reused.status).toBe(401);
  });
  it("faz login, logout e rotação integral ao trocar a senha", async () => {
    const account = await register("rotation@example.com");
    const logout = await request(
      "/auth/logout",
      "POST",
      {},
      account.cookie,
      account.csrf,
    );
    expect(logout.status).toBe(200);
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);

    const login = await request("/auth/login", "POST", {
      email: "rotation@example.com",
      password: "esta e uma senha longa 2026",
    });
    expect(login.status).toBe(200);
    const current = authCookies(login);
    const changed = await request(
      "/auth/change-password",
      "POST",
      {
        currentPassword: "esta e uma senha longa 2026",
        newPassword: "senha substituta ainda longa 2026",
        revokeOtherSessions: true,
      },
      current.cookie,
      current.csrf,
    );
    expect(changed.status).toBe(200);
    const replacement = authCookies(changed);
    expect(replacement.cookie).not.toBe(current.cookie);
    expect(
      (await request("/auth/session", "GET", undefined, current.cookie)).status,
    ).toBe(401);
    expect(
      (await request("/auth/session", "GET", undefined, replacement.cookie))
        .status,
    ).toBe(200);
    expect(
      (
        await request("/auth/login", "POST", {
          email: "rotation@example.com",
          password: "esta e uma senha longa 2026",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/auth/login", "POST", {
          email: "rotation@example.com",
          password: "senha substituta ainda longa 2026",
        })
      ).status,
    ).toBe(200);
  });
  it("rejeita sessão expirada no armazenamento server-side", async () => {
    const account = await register("expired@example.com");
    await testEnv.DB.prepare(
      "UPDATE auth_sessions SET expires_at=? WHERE revoked_at IS NULL",
    )
      .bind("2000-01-01T00:00:00.000Z")
      .run();
    expect(
      (await request("/auth/session", "GET", undefined, account.cookie)).status,
    ).toBe(401);
  });
  it("bloqueia CSRF e isolamento de User A/User B", async () => {
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    const withoutCsrf = await request("/rpgs", "POST", rpg, a.cookie);
    expect(withoutCsrf.status).toBe(403);
    const created = await request("/rpgs", "POST", rpg, a.cookie, a.csrf);
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      item: { id: string; notes: string };
    };
    expect(body.item.notes).toBe("<script>alert(1)</script>");
    expect(
      (await request(`/rpgs/${body.item.id}`, "GET", undefined, b.cookie))
        .status,
    ).toBe(404);
    expect(
      (await request(`/rpgs/${body.item.id}`, "PATCH", rpg, b.cookie, b.csrf))
        .status,
    ).toBe(404);
    expect(
      (
        await request(
          `/rpgs/${body.item.id}`,
          "DELETE",
          undefined,
          b.cookie,
          b.csrf,
        )
      ).status,
    ).toBe(404);
  });
  it("rejeita SQL injection, JSON malformado e campo de mass assignment", async () => {
    const a = await register("security@example.com");
    const injection = await request(
      `/rpgs?search=${encodeURIComponent("' OR 1=1 --")}`,
      "GET",
      undefined,
      a.cookie,
    );
    expect(injection.status).toBe(200);
    expect(
      ((await injection.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);
    const malformed = await worker.default.fetch(`${origin}/api/v1/rpgs`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: a.cookie,
        "X-CSRF-Token": a.csrf,
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const mass = await request(
      "/rpgs",
      "POST",
      { ...rpg, userId: "victim" },
      a.cookie,
      a.csrf,
    );
    expect(mass.status).toBe(422);
  });
  it("isola campanhas e impede que B registre sessão na campanha de A", async () => {
    const a = await register("campaign-a@example.com");
    const b = await register("campaign-b@example.com");
    const createdRpg = await request("/rpgs", "POST", rpg, a.cookie, a.csrf);
    const rpgId = ((await createdRpg.json()) as { item: { id: string } }).item.id;
    const createdCampaign = await request(
      "/campaigns",
      "POST",
      { ...campaign, rpgId },
      a.cookie,
      a.csrf,
    );
    expect(createdCampaign.status).toBe(201);
    const campaignId = (
      (await createdCampaign.json()) as { item: { id: string } }
    ).item.id;
    const member = await request(
      `/campaigns/${campaignId}/members`,
      "POST",
      { playerName: "Adriana", characterName: "Lina", notes: "", active: true },
      a.cookie,
      a.csrf,
    );
    expect(member.status).toBe(201);
    const session = await request(
      `/campaigns/${campaignId}/sessions`,
      "POST",
      {
        title: "O chamado",
        playedAt: "2026-08-12",
        summary: "Resumo real do teste.",
        gmNotes: "",
        nextHooks: "A carta.",
        attendeeMemberIds: [],
      },
      a.cookie,
      a.csrf,
    );
    expect(session.status).toBe(201);
    const history = await request(
      `/campaigns/${campaignId}/sessions`,
      "GET",
      undefined,
      a.cookie,
    );
    expect(history.status).toBe(200);
    expect(((await history.json()) as { items: unknown[] }).items).toHaveLength(1);
    expect(
      (
        await request(
          `/campaigns/${campaignId}`,
          "GET",
          undefined,
          b.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/campaigns/${campaignId}/sessions`,
          "POST",
          {
            title: "Sessão indevida",
            playedAt: "2026-08-12",
            summary: "",
            gmNotes: "",
            nextHooks: "",
            attendeeMemberIds: [],
          },
          b.cookie,
          b.csrf,
        )
      ).status,
    ).toBe(404);
  });
  it("reutiliza grupos em RPGs e campanhas e sincroniza o elenco", async () => {
    const account = await register("groups@example.com");
    const groupResponse = await request("/groups", "POST", { name: "Mesa de sábado", notes: "Grupo principal" }, account.cookie, account.csrf);
    expect(groupResponse.status).toBe(201);
    const groupId = ((await groupResponse.json()) as {item:{id:string}}).item.id;
    const memberResponse = await request(`/groups/${groupId}/members`, "POST", { playerName: "Adriana", notes: "Prefere fantasia", active: true }, account.cookie, account.csrf);
    expect(memberResponse.status).toBe(201);
    const groupMemberId = ((await memberResponse.json()) as {id:string}).id;
    const rpgResponse = await request("/rpgs", "POST", { ...rpg, playGroupId: groupId, playGroupNotes: "" }, account.cookie, account.csrf);
    expect(rpgResponse.status).toBe(201);
    const rpgBody = (await rpgResponse.json()) as {item:{id:string;playGroupName:string;readiness:string}};
    expect(rpgBody.item.playGroupName).toBe("Mesa de sábado");
    const campaignResponse = await request("/campaigns", "POST", { ...campaign, rpgId: rpgBody.item.id, playGroupId: groupId, legacyCharactersText: "" }, account.cookie, account.csrf);
    expect(campaignResponse.status).toBe(201);
    const campaignId = ((await campaignResponse.json()) as {item:{id:string}}).item.id;
    const detail = await request(`/campaigns/${campaignId}`, "GET", undefined, account.cookie);
    expect(((await detail.json()) as {members:Array<{playerName:string}>}).members.map((item)=>item.playerName)).toEqual(["Adriana"]);
    const update = await request(`/groups/${groupId}/members/${groupMemberId}`, "PATCH", { playerName: "Adriana L.", notes: "", active: true }, account.cookie, account.csrf);
    expect(update.status).toBe(200);
    const updatedDetail = await request(`/campaigns/${campaignId}`, "GET", undefined, account.cookie);
    expect(((await updatedDetail.json()) as {members:Array<{playerName:string}>}).members[0].playerName).toBe("Adriana L.");
    const intruder = await register("groups-intruder@example.com");
    const intruderGroupResponse = await request("/groups", "POST", { name: "Outro grupo", notes: "" }, intruder.cookie, intruder.csrf);
    const intruderGroupId = ((await intruderGroupResponse.json()) as {item:{id:string}}).item.id;
    const crossAccountUpdate = await request(`/groups/${intruderGroupId}/members/${groupMemberId}`, "PATCH", { playerName: "Nome indevido", notes: "", active: false }, intruder.cookie, intruder.csrf);
    expect(crossAccountUpdate.status).toBe(404);
    const detailAfterCrossAccountUpdate = await request(`/campaigns/${campaignId}`, "GET", undefined, account.cookie);
    expect(((await detailAfterCrossAccountUpdate.json()) as {members:Array<{playerName:string;active:number}>}).members[0]).toMatchObject({ playerName: "Adriana L.", active: 1 });
    const backup = await request('/export','GET',undefined,account.cookie);
    const backupData = (await backup.json()) as {version:number;data:{groups:unknown[];groupMembers:unknown[];preferences:Array<{theme:string}>}};
    expect(backupData.version).toBe(5);
    expect(backupData.data.groups).toHaveLength(1);
    expect(backupData.data.groupMembers).toHaveLength(1);
    expect(backupData.data.preferences).toEqual([expect.objectContaining({theme:'SYSTEM'})]);
  });
  it("oferece taxonomia abrangente e busca contas sem expor e-mail", async () => {
    const owner = await register("directory-owner@example.com");
    const narrator = await register("narrator-public@example.com");
    const metadata = await request('/rpgs/metadata','GET',undefined,owner.cookie);
    const taxonomy = (await metadata.json()) as {categories:Array<{name:string}>;subgenres:Array<{name:string}>};
    expect(taxonomy.categories).toHaveLength(18);
    expect(taxonomy.subgenres).toHaveLength(113);
    expect(taxonomy.categories.map((item)=>item.name)).toEqual(expect.arrayContaining(['Ação e Aventura','Histórico','Social e Político']));
    expect(taxonomy.subgenres.map((item)=>item.name)).toEqual(expect.arrayContaining(['Fantasia Arturiana','Horror Gótico','Viagem no Tempo e Dimensões']));
    expect((await request('/directory/users?q=na','GET',undefined,owner.cookie)).status).toBe(422);
    const search = await request('/directory/users?q=narrator','GET',undefined,owner.cookie);
    expect(search.status).toBe(200);
    const found = ((await search.json()) as {items:Array<Record<string,unknown>>}).items;
    expect(found).toContainEqual({id:narrator.user.id,displayName:'narrator-public'});
    expect(found[0]).not.toHaveProperty('email');
    const exactEmailSearch = await request('/directory/users?q=narrator-public@example.com','GET',undefined,owner.cookie);
    expect(((await exactEmailSearch.json()) as {items:unknown[]}).items).toEqual([{id:narrator.user.id,displayName:'narrator-public'}]);
  });
  it("vincula contas ao grupo, mantém um narrador e aplica o narrador à campanha", async () => {
    const owner = await register("linked-owner@example.com");
    const firstNarrator = await register("first-narrator@example.com");
    const secondNarrator = await register("second-narrator@example.com");
    const groupResponse = await request('/groups','POST',{name:'Grupo vinculado',notes:''},owner.cookie,owner.csrf);
    const groupId = ((await groupResponse.json()) as {item:{id:string}}).item.id;
    expect((await request(`/groups/${groupId}/members`,'POST',{playerName:'Nome forjado',userId:firstNarrator.user.id,notes:'',active:true,isGameMaster:true},owner.cookie,owner.csrf)).status).toBe(201);
    expect((await request(`/groups/${groupId}/members`,'POST',{playerName:'Outro nome forjado',userId:secondNarrator.user.id,notes:'',active:true,isGameMaster:true},owner.cookie,owner.csrf)).status).toBe(201);
    const group = await request(`/groups/${groupId}`,'GET',undefined,owner.cookie);
    const groupData = (await group.json()) as {item:{gameMasterName:string};members:Array<{playerName:string;linkedUserId:string;isGameMaster:number}>};
    expect(groupData.item.gameMasterName).toBe('second-narrator');
    expect(groupData.members).toEqual(expect.arrayContaining([
      expect.objectContaining({playerName:'first-narrator',linkedUserId:firstNarrator.user.id,isGameMaster:0}),
      expect.objectContaining({playerName:'second-narrator',linkedUserId:secondNarrator.user.id,isGameMaster:1}),
    ]));
    const createdRpg = await request('/rpgs','POST',{...rpg,title:'RPG do grupo',playGroupId:groupId,gameMaster:''},owner.cookie,owner.csrf);
    const rpgId = ((await createdRpg.json()) as {item:{id:string}}).item.id;
    const createdCampaign = await request('/campaigns','POST',{...campaign,name:'Campanha vinculada',rpgId,playGroupId:groupId,gameMaster:'',legacyCharactersText:''},owner.cookie,owner.csrf);
    expect(createdCampaign.status).toBe(201);
    const campaignItem = ((await createdCampaign.json()) as {item:{id:string;gameMaster:string}}).item;
    expect(campaignItem.gameMaster).toBe('second-narrator');
    const campaignDetail = await request(`/campaigns/${campaignItem.id}`,'GET',undefined,owner.cookie);
    const campaignMembers = ((await campaignDetail.json()) as {members:Array<{linkedUserId:string;isGameMaster:number}>}).members;
    expect(campaignMembers).toEqual(expect.arrayContaining([expect.objectContaining({linkedUserId:secondNarrator.user.id,isGameMaster:1})]));
  });
  it("importa data planejada do catálogo e preserva a campanha legada", async () => {
    const account = await register("imports@example.com");
    const catalogCsv = [
      'Sistema / Jogo,Categoria,Subgênero,Status da leitura,Quando jogar',
      'Blue Rose,Fantasia,Alta Fantasia,Lendo,20/09/2026',
    ].join('\n');
    const catalogPreview = await request('/import/preview','POST',{csv:catalogCsv},account.cookie,account.csrf);
    expect(catalogPreview.status).toBe(200);
    const catalogJob = (await catalogPreview.json()) as {jobId:string;canConfirm:boolean};
    expect(catalogJob.canConfirm).toBe(true);
    expect((await request('/import/confirm','POST',{jobId:catalogJob.jobId,approvedRows:[2]},account.cookie,account.csrf)).status).toBe(200);
    const catalog = await request('/rpgs','GET',undefined,account.cookie);
    const importedRpg = ((await catalog.json()) as {items:Array<{plannedPlayDate:string}>}).items[0];
    expect(importedRpg.plannedPlayDate).toBe('2026-09-20');
    const campaignsCsv = [
      'Campanha,RPG / Sistema,Status,Mestre,Grupo / Jogadores,Personagens,Sessão Zero,Primeira Sessão,Frequência,Próxima Sessão,Última Sessão,Sessões Realizadas,Meta de Sessões,Observações',
      'A Coroa Azul,Blue Rose,Em andamento,Rogério,"Adriana, Marcelo","Lina, Téo",01/09/2026,08/09/2026,Quinzenal,22/09/2026,08/09/2026,3,12,Legado preservado',
    ].join('\n');
    const campaignPreview = await request('/import/campaigns/preview','POST',{csv:campaignsCsv},account.cookie,account.csrf);
    expect(campaignPreview.status).toBe(200);
    const campaignJob = (await campaignPreview.json()) as {jobId:string;canConfirm:boolean};
    expect(campaignJob.canConfirm).toBe(true);
    expect((await request('/import/campaigns/confirm','POST',{jobId:campaignJob.jobId},account.cookie,account.csrf)).status).toBe(200);
    const campaigns = await request('/campaigns','GET',undefined,account.cookie);
    const importedCampaign = ((await campaigns.json()) as {items:Array<{legacyMembersText:string;legacyCharactersText:string;sessionsCompleted:number;lastSessionDate:string}>}).items[0];
    expect(importedCampaign).toMatchObject({legacyMembersText:'Adriana, Marcelo',legacyCharactersText:'Lina, Téo',sessionsCompleted:3,lastSessionDate:'2026-09-08'});
  });
  it("atualiza somente a capa existente, preserva os dados e torna a repetição idempotente", async () => {
    const account = await register("cover-imports@example.com");
    const created = await request('/rpgs','POST',{...rpg,title:'Ryuutama',notes:'Notas existentes que não podem mudar',coverUrl:null},account.cookie,account.csrf);
    expect(created.status).toBe(201);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('image',{status:200,headers:{'Content-Type':'image/png'}})));
    const coverUrl='https://i0.wp.com/www.huginnemuninn.com.br/wp-content/uploads/2024/02/capa-ryuutama.png?fit=600%2C847&ssl=1';
    const csv=[
      'Sistema / Jogo,Categoria,Subgênero,Status da leitura,Observações,Capa URL,ISBN,Fonte da capa,Nota da capa',
      `  RYUUTAMA  ,Fantasia,Alta Fantasia,Lido,Texto do CSV não deve sobrescrever,${coverUrl},,https://www.huginnemuninn.com.br/product/ryuutama-um-rpg-de-fantasia-natural/,Fonte oficial`,
    ].join('\n');
    const previewResponse=await request('/import/preview','POST',{csv},account.cookie,account.csrf);
    expect(previewResponse.status).toBe(200);
    const preview=await previewResponse.json() as {jobId:string;items:Array<{row:number;classification:string}>};
    expect(preview.items).toEqual([expect.objectContaining({row:2,classification:'ATUALIZACAO'})]);
    const beforeConfirm=await request('/rpgs','GET',undefined,account.cookie);
    expect(((await beforeConfirm.json()) as {items:Array<{coverUrl:string|null}>}).items[0].coverUrl).toBeNull();
    const confirmed=await request('/import/confirm','POST',{jobId:preview.jobId,approvedRows:[2]},account.cookie,account.csrf);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({imported:0,updated:1});
    const afterConfirm=await request('/rpgs','GET',undefined,account.cookie);
    const items=(await afterConfirm.json()) as {items:Array<{title:string;notes:string;coverUrl:string;coverSourceUrl:string}>};
    expect(items.items).toHaveLength(1);
    expect(items.items[0]).toMatchObject({title:'Ryuutama',notes:'Notas existentes que não podem mudar',coverUrl,coverSourceUrl:'https://www.huginnemuninn.com.br/product/ryuutama-um-rpg-de-fantasia-natural/'});
    const repeated=await request('/import/preview','POST',{csv},account.cookie,account.csrf);
    const repeatedPreview=await repeated.json() as {canConfirm:boolean;items:Array<{classification:string}>};
    expect(repeatedPreview.canConfirm).toBe(false);
    expect(repeatedPreview.items[0].classification).toBe('IGNORADO');
    vi.unstubAllGlobals();
  });
  it("classifica capa insegura como erro sem gravar", async () => {
    const account=await register('invalid-cover@example.com');
    const csv=['Sistema / Jogo,Categoria,Subgênero,Status da leitura,cover_url','Novo RPG,Fantasia,Alta Fantasia,Lido,http://127.0.0.1/capa.jpg'].join('\n');
    const response=await request('/import/preview','POST',{csv},account.cookie,account.csrf);
    expect(response.status).toBe(200);
    const preview=await response.json() as {canConfirm:boolean;items:Array<{classification:string;message:string}>};
    expect(preview.canConfirm).toBe(false);
    expect(preview.items[0]).toMatchObject({classification:'ERRO'});
    expect(preview.items[0].message).toContain('CAPA INVÁLIDA');
    const catalog=await request('/rpgs','GET',undefined,account.cookie);
    expect(((await catalog.json()) as {items:unknown[]}).items).toHaveLength(0);
  });
  it("preserva a capa de Blue Rose e aplica somente as linhas aprovadas", async () => {
    const account=await register('selective-cover@example.com');
    const blueRose=await request('/rpgs','POST',{...rpg,title:'Blue Rose'},account.cookie,account.csrf);
    const blueRoseId=((await blueRose.json()) as {item:{id:string}}).item.id;
    const dragonAge=await request('/rpgs','POST',{...rpg,title:'Dragon Age'},account.cookie,account.csrf);
    const dragonAgeId=((await dragonAge.json()) as {item:{id:string}}).item.id;
    const alien=await request('/rpgs','POST',{...rpg,title:'Alien'},account.cookie,account.csrf);
    const originalCover='https://www.jamboeditora.com.br/wp-content/uploads/2023/03/jamboeditora-capa-blue-rose-560x560.png';
    await testEnv.DB.prepare('UPDATE rpgs SET cover_url=? WHERE id=?').bind(originalCover,blueRoseId).run();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('image',{status:200,headers:{'Content-Type':'image/jpeg'}})));
    const csv=[
      'Sistema / Jogo,Categoria,Subgênero,Status da leitura,Capa URL',
      'Blue Rose,Fantasia,Alta Fantasia,Lendo,https://covers.openlibrary.org/b/isbn/111-L.jpg',
      'Dragon Age,Fantasia,Alta Fantasia,Lendo,https://covers.openlibrary.org/b/isbn/222-L.jpg',
      'Alien,Ficção Científica,Space Opera,Lendo,https://covers.openlibrary.org/b/isbn/333-L.jpg',
    ].join('\n');
    const response=await request('/import/preview','POST',{csv},account.cookie,account.csrf);
    expect(response.status).toBe(200);
    const preview=await response.json() as {jobId:string;items:Array<{row:number;classification:string}>};
    expect(preview.items.map((item)=>item.classification)).toEqual(['IGNORADO','ATUALIZACAO','ATUALIZACAO']);
    const confirmed=await request('/import/confirm','POST',{jobId:preview.jobId,approvedRows:[3]},account.cookie,account.csrf);
    expect(await confirmed.json()).toMatchObject({updated:1});
    const rows=await testEnv.DB.prepare('SELECT id,cover_url FROM rpgs WHERE user_id=?').bind(account.user.id).all<{id:string;cover_url:string|null}>();
    const covers=new Map(rows.results.map((item)=>[item.id,item.cover_url]));
    expect(covers.get(blueRoseId)).toBe(originalCover);
    expect(covers.get(dragonAgeId)).toBe('https://covers.openlibrary.org/b/isbn/222-L.jpg');
    expect(covers.get(((await alien.json()) as {item:{id:string}}).item.id)).toBeNull();
    vi.unstubAllGlobals();
  });
  it("rejeita payload excessivo e devolve cabeçalhos defensivos", async () => {
    const account = await register("headers@example.com");
    const oversized = await worker.default.fetch(`${origin}/api/v1/rpgs`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: account.cookie,
        "X-CSRF-Token": account.csrf,
        "Content-Type": "application/json",
        "Content-Length": "1000001",
      },
      body: "{}",
    });
    expect(oversized.status).toBe(413);
    const health = await request("/health");
    expect(health.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("strict-transport-security")).toContain(
      "max-age=31536000",
    );
  });
  it("aplica bloqueio progressivo por conta após falhas de login", async () => {
    await register("rate-limit@example.com");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await request("/auth/login", "POST", {
        email: "rate-limit@example.com",
        password: "senha errada mas com tamanho válido",
      });
      expect(failed.status).toBe(401);
    }
    const blocked = await request("/auth/login", "POST", {
      email: "rate-limit@example.com",
      password: "senha errada mas com tamanho válido",
    });
    expect(blocked.status).toBe(429);
  });
});
