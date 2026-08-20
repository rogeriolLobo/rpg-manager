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
// LIB-002: cover_url é lido de `publications` (fonte de verdade editorial), não mais da coluna
// homônima legada em `rpgs` — ver src/server/routes/library-writes.ts. Testes que simulam um
// registro "legado" gravando a capa direto no banco (bypassando a API) precisam escrever na
// tabela certa para que o GET/PATCH reais enxerguem o valor simulado.
async function setLegacyCoverUrl(rpgId: string, coverUrl: string | null) {
  await testEnv.DB.prepare("UPDATE publications SET cover_url=? WHERE id=(SELECT publication_id FROM rpgs WHERE id=?)").bind(coverUrl, rpgId).run();
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
    const backupData = (await backup.json()) as {schemaVersion:number;data:{groups:unknown[];groupMembers:unknown[];preferences:Array<{theme:string}>}};
    expect(backupData.schemaVersion).toBe(9);
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
  it("busca por e-mail/nome longos (até 254 caracteres aceitos no input) nunca quebra com erro cru de SQL (achado real: D1 rejeita LIKE acima de um limite bem menor que 254)", async () => {
    const owner = await register("directory-longsearch-owner@example.com");
    // 60+ caracteres — plausível para uma conta real (nome composto/e-mail corporativo longo),
    // e o suficiente para ter estourado "LIKE or GLOB pattern too complex" antes do fix (achado
    // real via E2E: tests/e2e/social-library-invites.spec.ts).
    const longEmail = `directory-longsearch-friend-${'x'.repeat(40)}@example.com`;
    const friend = await register(longEmail);
    const byExactLongEmail = await request(`/directory/users?q=${encodeURIComponent(longEmail)}`,'GET',undefined,owner.cookie);
    expect(byExactLongEmail.status).toBe(200);
    expect(((await byExactLongEmail.json()) as {items:Array<{id:string}>}).items).toEqual([{id:friend.user.id,displayName:expect.any(String)}]);
    // Nome parcial longo (LIKE truncado internamente) — nunca 500, sempre uma resposta válida
    // (pode não achar nada, o que é aceitável: o que não pode acontecer é o servidor quebrar).
    const byLongPartialName = await request(`/directory/users?q=${encodeURIComponent(longEmail.slice(0,80))}`,'GET',undefined,owner.cookie);
    expect(byLongPartialName.status).toBe(200);
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
    await setLegacyCoverUrl(blueRoseId, originalCover);
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
    const rows=await testEnv.DB.prepare('SELECT r.id,p.cover_url FROM rpgs r LEFT JOIN publications p ON p.id=r.publication_id WHERE r.user_id=?').bind(account.user.id).all<{id:string;cover_url:string|null}>();
    const covers=new Map(rows.results.map((item)=>[item.id,item.cover_url]));
    expect(covers.get(blueRoseId)).toBe(originalCover);
    expect(covers.get(dragonAgeId)).toBe('https://covers.openlibrary.org/b/isbn/222-L.jpg');
    expect(covers.get(((await alien.json()) as {item:{id:string}}).item.id)).toBeNull();
    vi.unstubAllGlobals();
  });
  it("importer não reprova CSV com capa legada já preservada, mesmo fora da allowlist atual", async () => {
    const account = await register('import-legacy-cover@example.com');
    const created = await request('/rpgs', 'POST', { ...rpg, title: 'RPG Legado Import' }, account.cookie, account.csrf);
    const importRpgId = ((await created.json()) as { item: { id: string } }).item.id;
    const legacyCoverUrl = 'https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png';
    await setLegacyCoverUrl(importRpgId, legacyCoverUrl);

    // Simula reexportar/reimportar o catálogo: a mesma capa legada (fora da allowlist atual)
    // volta no CSV para uma linha cujo RPG já existe e já tem capa própria — deve ser
    // apenas preservada (IGNORADO), sem reprovar o CSV por uma capa que nem será escrita.
    const csv = [
      'Sistema / Jogo,Categoria,Subgênero,Status da leitura,Capa URL',
      `RPG Legado Import,Fantasia,Alta Fantasia,Lendo,${legacyCoverUrl}`,
    ].join('\n');
    const response = await request('/import/preview', 'POST', { csv }, account.cookie, account.csrf);
    expect(response.status).toBe(200);
    const preview = await response.json() as { items: Array<{ classification: string; message: string }> };
    expect(preview.items[0].classification).toBe('IGNORADO');
    expect(preview.items[0].message).not.toContain('CAPA INVÁLIDA');
  });
  it("permite editar RPG legado sem alterar capa fora da allowlist atual de hosts (regressão: 'Dados inválidos')", async () => {
    const account = await register("legacy-cover@example.com");
    const created = await request("/rpgs", "POST", { ...rpg, title: "RPG Legado", coverUrl: null }, account.cookie, account.csrf);
    expect(created.status).toBe(201);
    const rpgId = ((await created.json()) as { item: { id: string } }).item.id;
    // Simula um registro legado/importado cuja capa aponta para um host que não está na allowlist atual.
    const legacyCoverUrl = "https://encrypted-tbn2.gstatic.com/shopping?q=tbn:ANd9GcSlegacythumb";
    await setLegacyCoverUrl(rpgId, legacyCoverUrl);

    // READ MODEL: exatamente o que o frontend usa para preencher o formulário de edição.
    const got = await request(`/rpgs/${rpgId}`, "GET", undefined, account.cookie);
    expect(got.status).toBe(200);
    const item = ((await got.json()) as { item: Record<string, unknown> }).item;
    expect(item.coverUrl).toBe(legacyCoverUrl);

    // UPDATE MODEL: salvar sem alterar nada precisa funcionar (mesmo payload que a UI monta a partir do GET).
    const unchangedPayload = {
      title: item.title, categoryId: item.categoryId, subgenreId: item.subgenreId, readingStatus: item.readingStatus,
      hasPlayed: item.hasPlayed, wantsToPlay: item.wantsToPlay, priority: item.priority, playGroupNotes: item.playGroupNotes,
      playGroupId: item.playGroupId, plannedPlayDate: item.plannedPlayDate, tableStatus: item.tableStatus, gameMaster: item.gameMaster,
      notes: item.notes, coverUrl: item.coverUrl, isbn: item.isbn, coverSourceUrl: item.coverSourceUrl, coverSourceNote: item.coverSourceNote,
    };
    const saved = await request(`/rpgs/${rpgId}`, "PATCH", unchangedPayload, account.cookie, account.csrf);
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { item: { coverUrl: string | null } }).item.coverUrl).toBe(legacyCoverUrl);

    // Alterar "Quero jogar" e salvar precisa persistir, preservando a capa legada intacta.
    const changed = await request(`/rpgs/${rpgId}`, "PATCH", { ...unchangedPayload, wantsToPlay: true }, account.cookie, account.csrf);
    expect(changed.status).toBe(200);
    const changedItem = ((await changed.json()) as { item: { wantsToPlay: boolean; coverUrl: string | null } }).item;
    expect(changedItem.wantsToPlay).toBe(true);
    expect(changedItem.coverUrl).toBe(legacyCoverUrl);

    // Uma capa NOVA insegura (IP loopback, não é sobre "host autorizado") continua rejeitada.
    const rejected = await request(`/rpgs/${rpgId}`, "PATCH", { ...unchangedPayload, coverUrl: "https://127.0.0.1/x.jpg" }, account.cookie, account.csrf);
    expect(rejected.status).toBe(422);
    const rejectedBody = (await rejected.json()) as { error: { code: string; fields?: Record<string, string[]> } };
    expect(rejectedBody.error.code).toBe("VALIDATION_ERROR");
    // O erro precisa carregar "fields" para que o frontend destaque o campo coverUrl, e não só
    // exiba a mensagem genérica no topo.
    expect(rejectedBody.error.fields?.coverUrl?.[0]).toBeTruthy();
  });
  it("coverUrl (LIB-001): qualquer HTTPS público é aceito — servidor nunca busca a URL, só o navegador", async () => {
    // A capa é usada só como <img src> pelo navegador; o servidor não faz fetch dela, então não
    // existe allowlist de hosts (não escala para um catálogo mundial de editoras). A única
    // política é sintática: HTTPS público, sem IP privado/loopback, sem protocolo perigoso.
    const account = await register("devir-cover@example.com");
    const devirCoverUrl = "https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png";

    // CREATE com um host real "desconhecido" (não estava em nenhuma allowlist antiga) → aceito.
    const created = await request("/rpgs", "POST", { ...rpg, title: "RPG com Capa Devir", coverUrl: devirCoverUrl }, account.cookie, account.csrf);
    expect(created.status).toBe(201);
    const devirRpgId = ((await created.json()) as { item: { id: string; coverUrl: string } }).item.id;

    const item = ((await (await request(`/rpgs/${devirRpgId}`, "GET", undefined, account.cookie)).json()) as { item: Record<string, unknown> }).item;
    const base = {
      title: item.title, categoryId: item.categoryId, subgenreId: item.subgenreId, readingStatus: item.readingStatus,
      hasPlayed: item.hasPlayed, wantsToPlay: item.wantsToPlay, priority: item.priority, playGroupNotes: item.playGroupNotes,
      playGroupId: item.playGroupId, plannedPlayDate: item.plannedPlayDate, tableStatus: item.tableStatus, gameMaster: item.gameMaster,
      notes: item.notes, isbn: item.isbn, coverSourceUrl: item.coverSourceUrl, coverSourceNote: item.coverSourceNote,
    };

    // Editar sem alterar a capa -> preserva.
    const unchanged = await request(`/rpgs/${devirRpgId}`, "PATCH", { ...base, coverUrl: devirCoverUrl }, account.cookie, account.csrf);
    expect(unchanged.status).toBe(200);
    expect(((await unchanged.json()) as { item: { coverUrl: string } }).item.coverUrl).toBe(devirCoverUrl);

    // Trocar para outro host HTTPS público qualquer (nunca esteve em nenhuma allowlist) -> aceito.
    const newHostUrl = "https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg";
    const changed = await request(`/rpgs/${devirRpgId}`, "PATCH", { ...base, coverUrl: newHostUrl }, account.cookie, account.csrf);
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { item: { coverUrl: string } }).item.coverUrl).toBe(newHostUrl);

    // URL insegura (IP loopback/privado, protocolo perigoso, sem HTTPS) continua rejeitada —
    // isso não é sobre host "autorizado", é sobre a forma da URL ser segura.
    for (const unsafe of ["http://exemplo.com/x.jpg", "https://127.0.0.1/x.jpg", "https://192.168.1.10/x.jpg", "javascript:alert(1)", "data:image/png;base64,abc"]) {
      const rejected = await request(`/rpgs/${devirRpgId}`, "PATCH", { ...base, coverUrl: unsafe }, account.cookie, account.csrf);
      expect(rejected.status).toBe(422);
    }
    const afterRejected = await testEnv.DB.prepare("SELECT p.cover_url cover_url FROM rpgs r LEFT JOIN publications p ON p.id=r.publication_id WHERE r.id=?").bind(devirRpgId).first<{ cover_url: string }>();
    expect(afterRejected?.cover_url).toBe(newHostUrl);

    // Remoção da capa: deve funcionar e normalizar para null (não é tratada como URL inválida).
    const removed = await request(`/rpgs/${devirRpgId}`, "PATCH", { ...base, coverUrl: null }, account.cookie, account.csrf);
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { item: { coverUrl: string | null } }).item.coverUrl).toBeNull();
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
  it("expõe /version sem autenticação e sem dados sensíveis", async () => {
    const response = await request("/version");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { commit: string; build: string; environment: string };
    expect(typeof body.commit).toBe("string");
    expect(typeof body.build).toBe("string");
    expect(typeof body.environment).toBe("string");
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/secret|token|password|pepper/iu);
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
