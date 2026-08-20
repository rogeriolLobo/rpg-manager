import { expect, test, type Page } from "@playwright/test";

// Seção 13 do pedido de finalização — Adventure full flow E2E: World -> Adventure -> Scene ->
// Handout -> Campaign -> GM Console -> preparar VTT Scene -> revelar handout -> Player recebe
// via WebSocket. `tests/e2e/adventure-prep.spec.ts` já cobre World->Adventure->Scene->
// Encounter->NPC->Handout (criação) via UI real — este spec continua exatamente de onde aquele
// para, cobrindo o trecho que faltava: vincular a Adventure a uma Campaign real, preparar a
// Mesa Virtual (GM Console) e provar que revelar o handout na tela de preparação da Adventure
// chega ao Player em tempo real (WebSocket), sem reload — sem repetir a parte já provada.
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

test("Adventure full flow (Seção 13): World → Adventure → Handout → Campaign → GM Console → VTT Scene → revelar handout → Player recebe via WebSocket", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  await register(page, `e2e-adv-flow-owner-${suffix}@example.com`, `Mestre Fluxo ${suffix}`);
  const csrf = csrfToken(await page.context().cookies());

  // ---- World -> Adventure (Vault entity) -> Handout ainda NÃO revelado. ----
  const worldResponse = await page.request.post("/api/v1/worlds", { headers: apiHeaders(csrf), data: { name: `Mundo Fluxo ${suffix}`, description: "", defaultRpgId: null, visibility: "PRIVATE" } });
  expect(worldResponse.status()).toBe(201);
  const worldId = ((await worldResponse.json()) as { item: { id: string } }).item.id;
  const adventureResponse = await page.request.post("/api/v1/vault", {
    headers: apiHeaders(csrf),
    data: { entityType: "ADVENTURE", name: `Aventura Fluxo ${suffix}`, summary: "", description: "", visibility: "PRIVATE", worldId, groupId: null, parentEntityId: null,
      adventure: { adventureType: "ONE_SHOT", recommendedSessions: 1, notes: "", premise: "", hooks: "", keyScenes: "", rewards: "" } },
  });
  expect(adventureResponse.status()).toBe(201);
  const adventureEntityId = ((await adventureResponse.json()) as { id: string }).id;
  const handoutResponse = await page.request.post(`/api/v1/adventures/${adventureEntityId}/handouts`, {
    headers: apiHeaders(csrf), data: { title: "Carta do Conselho", content: "Um pergaminho lacrado com o selo real.", sceneId: null, externalResourceId: null, revealed: false, sortOrder: 0 },
  });
  expect(handoutResponse.status()).toBe(201);

  // ---- Campaign vinculada à Adventure (adventureEntityId) + Player convidado (fluxo real de
  // amizade + convite de Campaign, já estabelecido em multi-gm.test.ts/accessibility.spec.ts). ----
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf), data: { title: `RPG Fluxo ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa Fluxo ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  try {
    await register(playerPage, `e2e-adv-flow-player-${suffix}@example.com`, `Jogador Fluxo ${suffix}`);
    const playerId = await playerPage.evaluate(async () => {
      const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
      return body.user.id;
    });
    const friendRequest = await page.request.post("/api/v1/social/requests", { headers: apiHeaders(csrf), data: { targetUserId: playerId } });
    expect(friendRequest.status()).toBe(201);
    const friendRequestId = ((await friendRequest.json()) as { item: { id: string } }).item.id;
    const playerCsrf = csrfToken(await playerContext.cookies());
    const acceptFriend = await playerPage.request.post(`/api/v1/social/requests/${friendRequestId}/accept`, { headers: apiHeaders(playerCsrf) });
    expect(acceptFriend.status()).toBe(200);
    const invite = await page.request.post("/api/v1/social/invites", { headers: apiHeaders(csrf), data: { inviteeUserId: playerId, targetType: "CAMPAIGN", targetId: campaignId, role: "PLAYER" } });
    expect(invite.status()).toBe(201);
    const inviteId = ((await invite.json()) as { item: { id: string } }).item.id;
    const acceptInvite = await playerPage.request.post(`/api/v1/social/invites/${inviteId}/accept`, { headers: apiHeaders(playerCsrf) });
    expect(acceptInvite.status()).toBe(200);

    // ---- GM Console: prepara a cena de VTT de verdade, via UI real (não API) — esta é a parte
    // "prep VTT Scene" pedida pela Seção 13, distinta da cena de PREPARAÇÃO narrativa da
    // Adventure (adventure_scenes, já coberta em adventure-prep.spec.ts). ----
    await page.goto(`/app/campaigns/${campaignId}/vtt`);
    await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible();
    const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
    await sceneForm.getByLabel("Título").fill("Salão do Conselho");
    await sceneForm.getByLabel("URL da imagem de fundo").fill("https://example.com/salao.png");
    await page.getByRole("button", { name: "Criar cena" }).click();
    await expect(page.getByText("Salão do Conselho")).toBeVisible();
    await page.getByRole("button", { name: "Ativar para os jogadores" }).click();
    await expect(page.getByText("Ao vivo")).toBeVisible();

    // ---- Player entra na Campanha (Minhas Mesas) ANTES da revelação — 0 handouts ainda. ----
    await playerPage.goto(`/app/my-tables/${campaignId}`);
    await expect(playerPage.getByRole("heading", { name: `Mesa Fluxo ${suffix}` })).toBeVisible({ timeout: 15_000 });
    await expect(playerPage.getByText("Nenhum handout revelado ainda.")).toBeVisible();

    // ---- GM revela o handout na tela de preparação da Adventure (UI real, mesmo botão já
    // provado em adventure-prep.spec.ts) -> chega ao Player em tempo real, SEM reload. ----
    await page.goto(`/app/vault/${adventureEntityId}/adventure`);
    await expect(page.getByText("Carta do Conselho")).toBeVisible();
    await expect(page.getByText("ainda não revelado")).toBeVisible();
    await page.getByRole("button", { name: "Revelar" }).click();
    await expect(page.getByText("revelado aos jogadores")).toBeVisible();

    await expect(playerPage.getByText("Carta do Conselho")).toBeVisible({ timeout: 10_000 });
    await expect(playerPage.getByText("Um pergaminho lacrado com o selo real.")).toBeVisible();
    await expect(playerPage.getByText("Nenhum handout revelado ainda.")).toHaveCount(0);
  } finally {
    await playerContext.close();
  }
});
