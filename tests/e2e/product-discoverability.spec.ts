import { expect, test, type Page } from "@playwright/test";

const password = "uma senha longa para e2e 2026";

async function register(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

function csrfToken(cookies: Array<{ name: string; value: string }>): string {
  return decodeURIComponent(cookies.find((cookie) => cookie.name === "rpg_csrf")?.value ?? "");
}

const apiHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:5173" });
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 850;

async function openMenu(page: Page) {
  if (isMobile(page)) await page.getByRole("button", { name: "Abrir menu" }).click();
}

async function navigateFromSidebar(page: Page, section: string | RegExp, link: string) {
  await openMenu(page);
  await page.getByRole("navigation", { name: section }).getByRole("link", { name: link, exact: true }).click();
}

async function openQuickAccess(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Acesso rápido" }).getByRole("link", { name: new RegExp(`^${label}`, "u") }).click();
}

test("Product Surface: áreas globais, Campaign Hub e Mesa do Mestre são descobertos somente pela UI", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  await register(page, `discovery-owner-${suffix}@example.com`, `Discovery ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG Discovery ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Campanha Discovery ${suffix}`, status: "PLANNING", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Painel do aventureiro" })).toBeVisible();

  for (const [label, href] of [
    ["Biblioteca", "/app/library"],
    ["Vault", "/app/vault"],
    ["Compêndio", "/app/compendium"],
    ["Fichas", "/app/sheets"],
  ] as const) {
    await expect(page.getByRole("navigation", { name: "Acesso rápido" }).getByRole("link", { name: new RegExp(`^${label}`, "u") })).toHaveAttribute("href", href);
  }

  await openQuickAccess(page, "Campanhas");
  await expect(page.getByRole("heading", { name: "Planejador de mesas" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Nova mesa única" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mesa do Mestre" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir campanha" }).click();
  await expect(page.getByRole("heading", { name: `Campanha Discovery ${suffix}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mesa do Mestre" })).toBeVisible();

  await page.locator(".page-header").getByRole("link", { name: "Mesa do Mestre", exact: true }).click();
  await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Prepare sua primeira cena" })).toBeVisible();
  await page.getByRole("button", { name: "Criar primeira cena" }).first().click();
  await expect(page.getByLabel("Título", { exact: true })).toBeFocused();
});

test("Product Surface: Campaign Hub cria, pré-seleciona e vincula Adventure e expõe One-Shot", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  await register(page, `discovery-adventure-${suffix}@example.com`, `Adventure Discovery ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG Adventure ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Campanha Adventure ${suffix}`, status: "PLANNING", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);

  await openQuickAccess(page, "Campanhas");
  await expect(page.getByRole("heading", { name: "Planejador de mesas" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Abrir campanha" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/[^/]+$/u);
  await expect(page.getByRole("heading", { level: 1, name: `Campanha Adventure ${suffix}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Nenhuma Adventure vinculada.")).toBeVisible();
  await page.getByRole("link", { name: "Criar Adventure" }).click();
  await expect(page.getByLabel("Tipo")).toHaveValue("ADVENTURE");
  await page.getByLabel("Nome", { exact: true }).fill(`Adventure Discovery ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page).toHaveURL(/\/app\/campaigns\/[^/]+\/edit\?adventureId=/u, { timeout: 30_000 });
  await expect(page.getByLabel("Adventure principal")).toHaveValue(/.+/u, { timeout: 30_000 });
  const invalidControls = await page.locator("form :invalid").evaluateAll((controls) => controls.map((control) => ({
    label: control.getAttribute("aria-label") ?? control.closest("label")?.childNodes[0]?.textContent?.trim() ?? control.tagName,
    value: (control as HTMLInputElement | HTMLSelectElement).value,
  })));
  expect(invalidControls).toEqual([]);
  const saveResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/v1\/campaigns\/[^/]+$/u.test(response.url()), { timeout: 30_000 });
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByRole("link", { name: `Adventure Discovery ${suffix}` }).first()).toBeVisible({ timeout: 30_000 });

  await navigateFromSidebar(page, "Mesas", "Campanhas");
  await page.getByRole("link", { name: "Nova mesa única" }).click();
  await expect(page.getByLabel("Formato")).toHaveValue("ONE_SHOT");
  await page.getByRole("button", { name: "Cancelar" }).click();
});

test("Product Surface: Mundo contextual e sistema são descobertos pela navegação visível", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  await register(page, `discovery-world-${suffix}@example.com`, `World Discovery ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const worldResponse = await page.request.post("/api/v1/worlds", {
    headers: apiHeaders(csrf),
    data: { name: `World Discovery ${suffix}`, description: "World usado para provar navegação visível.", defaultRpgId: null, visibility: "PRIVATE" },
  });
  expect(worldResponse.status()).toBe(201);

  await openQuickAccess(page, "Mundos");
  await page.getByRole("link", { name: new RegExp(`World Discovery ${suffix}`, "u") }).click();
  await expect(page.getByRole("heading", { name: `World Discovery ${suffix}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Selecionar contexto ativo")).not.toHaveValue("");
  await page.getByRole("navigation", { name: "Espaços do World" }).getByRole("link", { name: /^Wiki/u }).click();
  await expect(page).toHaveURL(/\/wiki$/u);

  await openMenu(page);
  for (const [label, href] of [
    ["Cartografia", /\/cartography$/u],
    ["Relações", /\/relations$/u],
    ["Timeline", /\/timeline$/u],
    ["Bestiário", /\/bestiary$/u],
  ] as const) {
    await expect(page.getByRole("navigation", { name: /World ativo/u }).getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }
  await page.getByRole("navigation", { name: /World ativo/u }).getByRole("link", { name: "Cartografia", exact: true }).click();
  await expect(page).toHaveURL(/\/cartography$/u);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });

  await navigateFromSidebar(page, "Sistema", "Configurações");
  await expect(page.getByRole("heading", { name: "Aparência, dados e portabilidade" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Restaurar backup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arquivos anexados" })).toBeVisible();
});

test("Product Surface: jogador encontra personagem, ficha, handout e VTT Live a partir do Dashboard", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const suffix = Date.now();
  await register(page, `discovery-gm-${suffix}@example.com`, `GM Discovery ${suffix}`);

  const playerContext = await browser.newContext();
  try {
    const playerPage = await playerContext.newPage();
    await register(playerPage, `discovery-player-${suffix}@example.com`, `Player Discovery ${suffix}`);
    const playerId = await playerPage.evaluate(async () => ((await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } }).user.id);
    const csrf = csrfToken(await page.context().cookies());

    const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(csrf), data: { name: `Grupo Discovery ${suffix}`, notes: "" } });
    const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
    await page.request.post(`/api/v1/groups/${groupId}/members`, { headers: apiHeaders(csrf), data: { playerName: "Player Discovery", userId: playerId, notes: "", active: true, isGameMaster: false } });

    const characterResponse = await page.request.post("/api/v1/vault", { headers: apiHeaders(csrf), data: { entityType: "CHARACTER", name: `Personagem Discovery ${suffix}`, summary: "Herói da mesa", description: "", visibility: "PLAYERS", worldId: null, groupId: null, parentEntityId: null, adventure: null, character: { playerUserId: null, pronouns: "", concept: "Explorador", status: "ACTIVE", notes: "" } } });
    const characterId = ((await characterResponse.json()) as { id: string }).id;
    const templateResponse = await page.request.post("/api/v1/sheets/templates", { headers: apiHeaders(csrf), data: { name: `Modelo Discovery ${suffix}`, description: "", worldId: null, gameSystemId: null, fields: [{ key: "conceito", label: "Conceito", type: "TEXT", required: true }], pdfUrl: null, pdfMapping: {} } });
    const templateId = ((await templateResponse.json()) as { id: string }).id;
    await page.request.put(`/api/v1/sheets/entities/${characterId}`, { headers: apiHeaders(csrf), data: { templateId, values: { conceito: "Explorador" } } });

    const adventureResponse = await page.request.post("/api/v1/vault", { headers: apiHeaders(csrf), data: { entityType: "ADVENTURE", name: `Adventure Player ${suffix}`, summary: "", description: "", visibility: "PRIVATE", worldId: null, groupId: null, parentEntityId: null, adventure: { adventureType: "ONE_SHOT", recommendedSessions: 1, notes: "", premise: "", hooks: "", keyScenes: "", rewards: "" } } });
    const adventureId = ((await adventureResponse.json()) as { id: string }).id;
    await page.request.post(`/api/v1/adventures/${adventureId}/handouts`, { headers: apiHeaders(csrf), data: { title: "Handout Discovery", content: "Pista revelada", sceneId: null, externalResourceId: null, revealed: true, sortOrder: 0 } });

    const rpgResponse = await page.request.post("/api/v1/rpgs", { headers: apiHeaders(csrf), data: { title: `RPG Player ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null } });
    const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
    const campaignResponse = await page.request.post("/api/v1/campaigns", { headers: apiHeaders(csrf), data: { rpgId, name: `Mesa Player ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "GM Discovery", playGroupId: groupId, adventureEntityId: adventureId, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" } });
    const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
    const campaignDetail = await page.request.get(`/api/v1/campaigns/${campaignId}`, { headers: apiHeaders(csrf) });
    const members = ((await campaignDetail.json()) as { members: Array<{ id: string; linkedUserId: string | null }> }).members;
    const playerMemberId = members.find((member) => member.linkedUserId === playerId)!.id;
    await page.request.patch(`/api/v1/campaigns/${campaignId}/members/${playerMemberId}`, { headers: apiHeaders(csrf), data: { playerName: "Player Discovery", characterName: "Personagem Discovery", characterEntityId: characterId, notes: "", active: true } });
    const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(csrf), data: { title: "Cena Discovery Live", mapId: null, imageUrl: "https://example.com/discovery-live.png", notes: "", fogEnabled: false, gridCols: 10, gridRows: 10 } });
    expect(sceneResponse.status()).toBe(201);
    const sceneId = ((await sceneResponse.json()) as { id: string }).id;
    const activateResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/activate`, { headers: apiHeaders(csrf), data: {} });
    expect(activateResponse.status()).toBe(200);

    await expect(playerPage).toHaveURL(/\/app$/u);
    await openQuickAccess(playerPage, "Minhas Mesas");
    await playerPage.getByRole("link", { name: new RegExp(`Mesa Player ${suffix}`, "u") }).click();
    await expect(playerPage.getByRole("heading", { name: "Meu Personagem" })).toBeVisible({ timeout: 30_000 });
    await expect(playerPage.getByText(`Personagem Discovery ${suffix}`)).toBeVisible();
    await expect(playerPage.getByRole("heading", { name: "Ficha de personagem" })).toBeVisible();
    await expect(playerPage.getByText("Handout Discovery")).toBeVisible();
    await playerPage.getByRole("link", { name: "Entrar na mesa" }).click();
    await expect(playerPage.getByRole("heading", { name: "Cena Discovery Live" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await playerContext.close();
  }
});
