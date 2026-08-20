import { expect, test, type Page } from "@playwright/test";

// Seção 15 do pedido de finalização — VTT full session E2E com os 4 contexts reais pedidos:
// Owner GM, Co-GM, Player, Outsider. Multi-GM (F-036/BATCH23) já tem cobertura completa de
// integração/HTTP+WebSocket em tests/integration/multi-gm.test.ts (matriz de segurança + 2 GMs
// reais em realtime) — este spec exercita a MESMA jornada por cima de contexts de NAVEGADOR
// reais (4 abas/contas simultâneas), provando visualmente o que a integração já prova
// funcionalmente: GM-A move token -> Co-GM vê sem reload (valida o hook useCampaignRealtime
// acrescentado nesta mesma rodada à Mesa do Mestre, Seção 7-9); Player nunca recebe token
// oculto/HP privado; Outsider nunca conecta.
//
// Handout reveal via realtime já tem cobertura própria dedicada (handout-realtime.test.ts +
// multi-gm.test.ts "Co-GM revela/oculta handout") — deliberadamente fora deste spec para não
// duplicar a cadeia de pré-requisitos (World -> Adventure -> Scene -> Handout) só para repetir
// uma asserção já provada em dois lugares.
async function register(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}
function csrfToken(cookies: Array<{ name: string; value: string }>): string {
  return decodeURIComponent(cookies.find((cookie) => cookie.name === "rpg_csrf")?.value ?? "");
}
const apiHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:5173" });

async function sessionUserId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
    return body.user.id;
  });
}

async function inviteAndAccept(owner: Page, ownerCsrf: string, inviteePage: Page, inviteeUserId: string, campaignId: string, role: "GM" | "PLAYER") {
  const friendRequest = await owner.request.post("/api/v1/social/requests", { headers: apiHeaders(ownerCsrf), data: { targetUserId: inviteeUserId } });
  expect(friendRequest.status()).toBe(201);
  const requestId = ((await friendRequest.json()) as { item: { id: string } }).item.id;
  const inviteeCsrf = csrfToken(await inviteePage.context().cookies());
  const acceptFriend = await inviteePage.request.post(`/api/v1/social/requests/${requestId}/accept`, { headers: apiHeaders(inviteeCsrf) });
  expect(acceptFriend.status()).toBe(200);
  const invite = await owner.request.post("/api/v1/social/invites", { headers: apiHeaders(ownerCsrf), data: { inviteeUserId, targetType: "CAMPAIGN", targetId: campaignId, role } });
  expect(invite.status()).toBe(201);
  const inviteId = ((await invite.json()) as { item: { id: string } }).item.id;
  const acceptInvite = await inviteePage.request.post(`/api/v1/social/invites/${inviteId}/accept`, { headers: apiHeaders(inviteeCsrf) });
  expect(acceptInvite.status()).toBe(200);
}

test("VTT full session (Seção 15): Owner GM + Co-GM + Player + Outsider, 4 contexts reais, tudo em realtime", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  await register(page, `e2e-vtt4-owner-${suffix}@example.com`, `Owner GM ${suffix}`);
  const ownerCsrf = csrfToken(await page.context().cookies());

  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(ownerCsrf),
    data: { title: `RPG VTT4 ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(ownerCsrf),
    data: { rpgId, name: `Mesa VTT4 ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, {
    headers: apiHeaders(ownerCsrf),
    data: { title: "Cena Multi-GM E2E", mapId: null, imageUrl: "https://example.com/vtt4.png", notes: "", fogEnabled: true, gridCols: 10, gridRows: 10 },
  });
  expect(sceneResponse.status()).toBe(201);
  const sceneId = ((await sceneResponse.json()) as { id: string }).id;
  const activateResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/activate`, { headers: apiHeaders(ownerCsrf), data: {} });
  expect(activateResponse.status()).toBe(200);

  const coGmContext = await browser.newContext();
  const coGmPage = await coGmContext.newPage();
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();

  try {
    await register(coGmPage, `e2e-vtt4-cogm-${suffix}@example.com`, `Co-GM ${suffix}`);
    await register(playerPage, `e2e-vtt4-player-${suffix}@example.com`, `Player ${suffix}`);
    await register(outsiderPage, `e2e-vtt4-outsider-${suffix}@example.com`, `Outsider ${suffix}`);
    const coGmId = await sessionUserId(coGmPage);
    const playerId = await sessionUserId(playerPage);

    await inviteAndAccept(page, ownerCsrf, coGmPage, coGmId, campaignId, "GM");
    await inviteAndAccept(page, ownerCsrf, playerPage, playerId, campaignId, "PLAYER");

    // ---- Outsider nunca entra: nem a Mesa do Mestre nem a visão do jogador (404, nunca 403 —
    // política anti-enumeração já estabelecida no resto do produto). ----
    await outsiderPage.goto(`/app/campaigns/${campaignId}/vtt`);
    await expect(outsiderPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible({ timeout: 15_000 });
    await outsiderPage.goto(`/app/campaigns/${campaignId}/vtt/live`);
    await expect(outsiderPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible({ timeout: 15_000 });

    // ---- Owner GM e Co-GM abrem a MESMA Mesa do Mestre em abas/contas diferentes; Player abre
    // a visão ao vivo. Todos conectados via WebSocket real ao mesmo Durable Object. ----
    await page.goto(`/app/campaigns/${campaignId}/vtt`);
    await expect(page.getByText("Cena Multi-GM E2E")).toBeVisible({ timeout: 20_000 });
    await coGmPage.goto(`/app/campaigns/${campaignId}/vtt`);
    await expect(coGmPage.getByText("Cena Multi-GM E2E")).toBeVisible({ timeout: 20_000 });
    await playerPage.goto(`/app/campaigns/${campaignId}/vtt/live`);
    await expect(playerPage.getByRole("heading", { name: "Cena Multi-GM E2E" })).toBeVisible({ timeout: 20_000 });
    await expect(playerPage.getByText("● Tempo real")).toBeVisible({ timeout: 15_000 });

    // Expande a cena na Mesa do Mestre para os tokens ficarem visíveis nas duas abas de GM.
    await page.getByRole("button", { name: "Expandir cena" }).click();
    await coGmPage.getByRole("button", { name: "Expandir cena" }).click();

    // ---- Fog: GM-A revela a célula (3,3) ANTES de criar tokens ali — a barreira de fog é do
    // SERVIDOR (GET .../live só devolve tokens cuja célula já foi revelada, ver
    // buildPlayerLiveScenePayload/tokenFogCell em vtt.ts), não só visual; sem revelar antes, o
    // Player nunca receberia nenhum token, mesmo visibleToPlayers:true. Player recebe a
    // revelação em realtime (WS), sem reload. ----
    await expect(playerPage.locator(".vtt-fog-cell-revealed")).toHaveCount(0);
    const fogResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/fog/reveal`, { headers: apiHeaders(ownerCsrf), data: { col: 3, row: 3 } });
    expect(fogResponse.status()).toBe(201);
    await expect(playerPage.locator(".vtt-fog-cell-revealed")).toHaveCount(1, { timeout: 5_000 });

    // x:35,y:35 num grid 10x10 cai exatamente na célula (3,3) já revelada (col=floor(35/100*10)=3).
    // ---- GM-A (Owner) cria um token VISÍVEL ao jogador, na célula revelada -> Co-GM vê SEM
    // reload (prova o hook useCampaignRealtime acrescentado nesta rodada à Mesa do Mestre) ->
    // Player também vê. ----
    const tokenResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/tokens`, {
      headers: apiHeaders(ownerCsrf), data: { label: "Herói Visível", entityId: null, x: 35, y: 35, visibleToPlayers: true },
    });
    expect(tokenResponse.status()).toBe(201);
    await expect(coGmPage.locator(".vtt-token").filter({ hasText: "HE" })).toBeVisible({ timeout: 5_000 });
    await expect(playerPage.locator(".vtt-token").filter({ hasText: "HE" })).toBeVisible({ timeout: 5_000 });

    // ---- GM-B (Co-GM) cria um token OCULTO ao jogador, na MESMA célula já revelada -> Owner vê
    // (GM enxerga tudo), Player NUNCA vê (visibleToPlayers:false é uma barreira independente da
    // fog, intocada pelo Multi-GM — mesmo com a célula revelada, token oculto nunca aparece). ----
    const coGmCsrf = csrfToken(await coGmContext.cookies());
    const hiddenTokenResponse = await coGmPage.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/tokens`, {
      headers: apiHeaders(coGmCsrf), data: { label: "Vilão Oculto", entityId: null, x: 35, y: 35, visibleToPlayers: false },
    });
    expect(hiddenTokenResponse.status()).toBe(201);
    await expect(page.locator(".vtt-token").filter({ hasText: "VI" })).toBeVisible({ timeout: 5_000 });
    await expect(playerPage.locator(".vtt-token").filter({ hasText: "VI" })).toHaveCount(0);

    // ---- Combate: GM-B (Co-GM) inicia -> Owner e Player recebem em realtime. GM-B avança turno
    // -> Owner e Player recebem o novo turno. HP privado nunca aparece na visão do jogador. ----
    const combatStart = await coGmPage.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/combat/start`, {
      headers: apiHeaders(coGmCsrf),
      data: { combatants: [
        { tokenId: null, name: "Herói Visível", initiative: 18, hpCurrent: 20, hpMax: 20, notes: "", visibleToPlayers: true },
        { tokenId: null, name: "Vilão Oculto", initiative: 12, hpCurrent: 30, hpMax: 30, notes: "segredo do mestre", visibleToPlayers: false },
      ] },
    });
    expect(combatStart.status()).toBe(201);
    await expect(page.getByText("Round 1")).toBeVisible({ timeout: 5_000 });
    await expect(playerPage.getByText("Round 1")).toBeVisible({ timeout: 5_000 });
    // Combatente oculto nunca aparece na visão do jogador; combatente visível sim.
    await expect(playerPage.getByText("Herói Visível")).toBeVisible();
    await expect(playerPage.getByText("Vilão Oculto")).toHaveCount(0);
    await expect(playerPage.getByText("segredo do mestre")).toHaveCount(0);

    // Ordem por iniciativa: Herói (18, visível) -> Vilão (12, oculto). Avança 2x para o turno
    // voltar ao combatente VISÍVEL (Round 2) — testar "Turno atual" bem no turno do combatente
    // oculto seria inconclusivo, já que o Player nunca renderiza esse combatente de jeito nenhum.
    let combatNext = await coGmPage.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/combat/next`, { headers: apiHeaders(coGmCsrf) });
    expect(combatNext.status()).toBe(200);
    combatNext = await coGmPage.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/combat/next`, { headers: apiHeaders(coGmCsrf) });
    expect(combatNext.status()).toBe(200);
    await expect(page.getByText("Round 2")).toBeVisible({ timeout: 5_000 });
    await expect(playerPage.getByText("Round 2")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Turno atual")).toBeVisible({ timeout: 5_000 });
    await expect(playerPage.getByText("Turno atual")).toBeVisible({ timeout: 5_000 });

    // ---- Reconexão: Player cai e reconecta -> continua recebendo o estado corretamente. ----
    await playerPage.reload();
    await expect(playerPage.getByRole("heading", { name: "Cena Multi-GM E2E" })).toBeVisible({ timeout: 20_000 });
    await expect(playerPage.getByText("● Tempo real")).toBeVisible({ timeout: 15_000 });
    await expect(playerPage.locator(".vtt-token").filter({ hasText: "HE" })).toBeVisible({ timeout: 5_000 });
  } finally {
    await coGmContext.close();
    await playerContext.close();
    await outsiderContext.close();
  }
});
