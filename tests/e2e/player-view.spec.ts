import { expect, test, type Page } from "@playwright/test";

// F-033 (Player View integrada): "Minhas Mesas" — o jogador descobre e entra em suas
// campanhas sem link do GM. Roda em chromium E mobile-chromium (playwright.config.ts) — mesma
// spec cobre a prioridade de mobile pedida pela correção de roadmap, sem duplicar teste.
// Timeouts mais folgados que o default do projeto (10s) pelo mesmo motivo documentado em
// tests/e2e/vtt-live.spec.ts — não é um `waitForTimeout` cego.
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
const isMobileViewport = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 850;
const openNav = async (page: Page) => { if (isMobileViewport(page)) await page.getByRole("button", { name: "Abrir menu" }).click(); };

test("Minhas Mesas (F-033): jogador descobre a campanha sem link do GM, vê seu personagem e os handouts revelados", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-pv-owner-${suffix}@example.com`;
  const playerEmail = `e2e-pv-player-${suffix}@example.com`;
  await register(page, ownerEmail, `Mestre PV ${suffix}`);

  const playerContext = await browser.newContext();
  let outsiderContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  // Auditoria final (2026-08-21): try/finally, não só chamadas de close() no fim do corpo — se
  // qualquer expect() acima lançasse, os contexts extras ficariam abertos pelo resto da fila
  // inteira de testes do worker (workers:1, mesmo processo/browser para toda a suíte),
  // acumulando memória até travar um teste bem mais adiante (achado real: era a causa raiz do
  // flake recorrente de vault-worlds-flow.spec.ts, confirmado via trace/screenshot de CI — ver
  // docs/product/MASTER_BACKLOG.md).
  try {
    const playerPage = await playerContext.newPage();
    await register(playerPage, playerEmail, `Jogador PV ${suffix}`);
    const playerId = await playerPage.evaluate(async () => {
      const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
      return body.user.id;
    });

    const ownerCsrf = csrfToken(await page.context().cookies());
    const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(ownerCsrf), data: { name: `Grupo PV ${suffix}`, notes: "" } });
    const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
    await page.request.post(`/api/v1/groups/${groupId}/members`, { headers: apiHeaders(ownerCsrf), data: { playerName: "Jogador", userId: playerId, notes: "", active: true, isGameMaster: false } });

    const characterResponse = await page.request.post("/api/v1/vault", {
      headers: apiHeaders(ownerCsrf),
      data: { entityType: "CHARACTER", name: "Elyndra Lâmina de Prata", summary: "Guerreira exilada", description: "", visibility: "PLAYERS", worldId: null, groupId: null, parentEntityId: null, adventure: null, character: { playerUserId: null, pronouns: "ela/dela", concept: "Guerreira exilada", status: "Ativa", notes: "" } },
    });
    const characterId = ((await characterResponse.json()) as { id: string }).id;

    const adventureResponse = await page.request.post("/api/v1/vault", {
      headers: apiHeaders(ownerCsrf),
      data: { entityType: "ADVENTURE", name: "A Sombra sobre Valdren", summary: "", description: "", visibility: "PRIVATE", worldId: null, groupId: null, parentEntityId: null, adventure: { adventureType: "SHORT_CAMPAIGN", recommendedSessions: null, notes: "", premise: "", hooks: "", keyScenes: "", rewards: "" } },
    });
    const adventureId = ((await adventureResponse.json()) as { id: string }).id;
    await page.request.post(`/api/v1/adventures/${adventureId}/handouts`, { headers: apiHeaders(ownerCsrf), data: { title: "Carta do Barão", content: "Venha me ver imediatamente.", sceneId: null, externalResourceId: null, revealed: true, sortOrder: 0 } });

    const rpgResponse = await page.request.post("/api/v1/rpgs", {
      headers: apiHeaders(ownerCsrf),
      data: { title: `RPG PV ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
    });
    const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
    const campaignResponse = await page.request.post("/api/v1/campaigns", {
      headers: apiHeaders(ownerCsrf),
      data: { rpgId, name: "Mesa de Valdren", status: "PLANNING", gameMaster: "Mestre PV", playGroupId: groupId, adventureEntityId: adventureId, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
    });
    const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;

    const membersResponse = await page.request.get(`/api/v1/campaigns/${campaignId}`, { headers: apiHeaders(ownerCsrf) });
    const members = ((await membersResponse.json()) as { members: Array<{ id: string; linkedUserId: string | null }> }).members;
    const memberId = members.find((member) => member.linkedUserId === playerId)!.id;
    await page.request.patch(`/api/v1/campaigns/${campaignId}/members/${memberId}`, { headers: apiHeaders(ownerCsrf), data: { playerName: "Jogador", characterName: "Elyndra", characterEntityId: characterId, notes: "", active: true } });

    // O jogador nunca recebeu um link — descobre a mesa sozinho pela navegação global.
    await playerPage.goto("/app");
    await openNav(playerPage);
    await playerPage.getByRole("link", { name: "Minhas Mesas" }).click();
    await expect(playerPage).toHaveURL(/\/app\/my-tables$/u);
    await expect(playerPage.getByRole("heading", { name: "Mesa de Valdren" })).toBeVisible({ timeout: 30_000 });
    await playerPage.getByRole("link", { name: "Mesa de Valdren" }).click();

    await expect(playerPage.getByRole("heading", { name: "Mesa de Valdren" })).toBeVisible({ timeout: 30_000 });
    await expect(playerPage.getByText("Elyndra Lâmina de Prata")).toBeVisible();
    await expect(playerPage.getByText("Carta do Barão")).toBeVisible();
    await expect(playerPage.getByText("O mestre ainda não ativou nenhuma cena")).toBeVisible();

    // Não-membro nunca acessa a home da campanha de outro jogador (anti-enumeração).
    outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await register(outsiderPage, `e2e-pv-outsider-${suffix}@example.com`, `Fora PV ${suffix}`);
    await outsiderPage.goto(`/app/my-tables/${campaignId}`);
    await expect(outsiderPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await playerContext.close();
    await outsiderContext?.close();
  }
});
