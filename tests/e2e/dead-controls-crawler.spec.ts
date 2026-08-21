import { expect, test, type Page } from "@playwright/test";

// Seção 18 do pedido de finalização: crawler automatizado de rotas/controles. Escopo
// deliberadamente NÃO-destrutivo (exigência explícita da própria Seção 18: "não deixar crawler
// destrutivo"):
//
// 1) Crawl real de LINKS (`a[href]` internos, /app/*): navega em largura a partir do Dashboard
//    com uma conta que tem dados reais (RPG/World ativo/Vault entity/Grupo/Campanha/amigo —
//    dados vazios escondem links que só aparecem quando há conteúdo), coletando todo link
//    alcançável e confirmando, para cada um: não 404 ("Não encontrado"), não crash (fallback do
//    ErrorBoundary), não falha de carregamento ("Não foi possível carregar"), não spinner preso
//    (indicador de loading precisa sumir dentro de um timeout), e a página realmente renderizou
//    algo (h1 visível) — não uma tela em branco.
// 2) Rotulagem de botões: em cada página visitada, todo `button`/`[role=button]`/`[role=menuitem]`
//    precisa ter nome acessível (texto, aria-label ou title) — nunca um controle mudo. Isto NUNCA
//    clica em botões (só inspeciona o DOM), então nunca aciona uma ação destrutiva/mutante — é a
//    parte segura do que a Seção 18 pede sobre "button"/"role=button"/"menuitem", deliberadamente
//    sem simular clique em cada um (clicar genericamente em todo botão do produto — incluindo os
//    que abrem `confirm()` de exclusão, submetem formulários ou revogam acesso — é exatamente o
//    risco que a própria Seção 18 manda evitar; a cobertura de CLIQUE em botões específicos já
//    existe nos outros specs de E2E deste repositório, um por fluxo de produto real).
//
// "Sair" (logout) nunca é seguido porque é um <button>, não um <a> — o crawler só segue <a>, então
// a exclusão de logout é estrutural, não uma lista negra frágil de texto.
const DENYLIST_TEXT = /sair|excluir|remover|revogar|apagar|deletar|bloquear|recusar|log ?out/iu;
const MAX_PAGES = 40;
const PER_PAGE_TIMEOUT = 30_000;

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

interface LinkInfo { href: string; text: string }
interface UnnamedButton { page: string; snippet: string }

async function collectLinksAndButtons(page: Page): Promise<{ links: LinkInfo[]; unnamedButtons: UnnamedButton[] }> {
  const links = await page.locator('a[href^="/app"]').evaluateAll((elements) =>
    elements.map((element) => ({ href: element.getAttribute("href") ?? "", text: (element.textContent ?? "").trim() })),
  );
  const unnamed = await page.locator('button, [role="button"], [role="menuitem"]').evaluateAll((elements) =>
    elements
      .filter((element) => {
        if (element.getAttribute("aria-hidden") === "true") return false;
        const name = (element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent ?? "").trim();
        return name.length === 0;
      })
      .map((element) => element.outerHTML.slice(0, 200)),
  );
  return {
    links: links.filter((link) => link.href && !DENYLIST_TEXT.test(link.text)),
    unnamedButtons: unnamed.map((snippet) => ({ page: page.url(), snippet })),
  };
}

async function assertPageHealthy(page: Page, from: string) {
  // Spinner preso: o indicador de loading (role="status", ver Loading em dashboard-page.tsx)
  // precisa sumir dentro do timeout — se count()===0 já de início, a asserção já está satisfeita.
  await expect(page.locator('[role="status"]')).toHaveCount(0, { timeout: PER_PAGE_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Não encontrado" }), `404 ao navegar a partir de ${from} -> ${page.url()}`).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "O grimório encontrou um erro." }), `crash (ErrorBoundary) ao navegar a partir de ${from} -> ${page.url()}`).not.toBeVisible();
  await expect(page.getByText("Não foi possível carregar"), `falha de carregamento ao navegar a partir de ${from} -> ${page.url()}`).not.toBeVisible();
  // Placeholder enganoso / tela em branco: alguma coisa real (h1) precisa ter renderizado.
  await expect(page.locator("h1").first(), `nenhum h1 renderizado em ${page.url()} (a partir de ${from})`).toBeVisible({ timeout: PER_PAGE_TIMEOUT });
}

test("Crawler de rotas/controles (Seção 18): todo link interno alcançável a partir do Dashboard carrega sem 404/crash/spinner preso, e todo botão tem nome acessível", async ({ page }) => {
  // Até 40 cargas diretas reinicializam providers e consultam o Worker/D1; margem local
  // proporcional ao escopo, sem reduzir rotas, controles ou asserções.
  test.setTimeout(900_000);
  const suffix = Date.now();
  await register(page, `e2e-crawler-owner-${suffix}@example.com`, `Crawler ${suffix}`);

  // ---- Semeadura de dados reais via API (rápida, evita flakiness de formulário) — dados vazios
  // escondem exatamente os links/estados que este crawler existe para verificar. ----
  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG Crawler ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const worldResponse = await page.request.post("/api/v1/worlds", { headers: apiHeaders(csrf), data: { name: `Mundo Crawler ${suffix}`, description: "", defaultRpgId: null, visibility: "PRIVATE" } });
  expect(worldResponse.status()).toBe(201);
  const worldName = `Mundo Crawler ${suffix}`;
  const worldId = ((await worldResponse.json()) as { item: { id: string } }).item.id;
  await page.request.post("/api/v1/vault", { headers: apiHeaders(csrf), data: { entityType: "NPC", name: "PNJ Crawler", summary: "", description: "", visibility: "PRIVATE", worldId, groupId: null, parentEntityId: null, adventure: null } });
  const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(csrf), data: { name: `Grupo Crawler ${suffix}`, notes: "" } });
  expect(groupResponse.status()).toBe(201);
  const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa Crawler ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: groupId, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(csrf), data: { title: "Cena Crawler", mapId: null, imageUrl: "https://example.com/crawler.png", notes: "" } });

  // ---- Ativa o World para que os módulos contextuais (Wiki/Diário/Cartografia/...) apareçam
  // na navegação — sem isso, o crawler nunca alcançaria essas rotas. ----
  await page.goto("/app");
  await page.getByLabel("Selecionar contexto ativo").selectOption({ label: worldName });
  await expect(page.getByRole("link", { name: "Wiki" })).toBeVisible({ timeout: 30_000 });

  // ---- BFS a partir do Dashboard. ----
  const visited = new Set<string>();
  const queue: Array<{ href: string; from: string }> = [{ href: "/app", from: "(início)" }];
  const unnamedButtons: UnnamedButton[] = [];
  const notFoundLinks: Array<{ href: string; from: string }> = [];

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const { href, from } = queue.shift()!;
    const key = href.split("?")[0]!;
    if (visited.has(key)) continue;
    visited.add(key);
    console.log(`[crawler] ${visited.size}/${MAX_PAGES} ${key}`);

    const response = await page.goto(href, { waitUntil: "domcontentloaded" });
    if (response && response.status() === 404) { notFoundLinks.push({ href, from }); continue; }
    await assertPageHealthy(page, from);

    const { links, unnamedButtons: pageUnnamed } = await collectLinksAndButtons(page);
    unnamedButtons.push(...pageUnnamed);
    for (const link of links) {
      const linkKey = link.href.split("?")[0]!;
      if (!visited.has(linkKey)) queue.push({ href: link.href, from: href });
    }
  }

  expect(notFoundLinks, `Links que resultaram em 404: ${JSON.stringify(notFoundLinks)}`).toHaveLength(0);
  // Dedup por snippet (o mesmo componente pode aparecer em várias linhas de uma lista).
  const distinctUnnamed = [...new Map(unnamedButtons.map((entry) => [entry.snippet, entry])).values()];
  expect(distinctUnnamed, `Controles sem nome acessível: ${JSON.stringify(distinctUnnamed, null, 2)}`).toHaveLength(0);

  // Prova de que o crawler realmente percorreu uma superfície ampla (não um teste vazio que
  // "passa" sem ter visitado nada) — cobre pelo menos os módulos globais + contextuais de World.
  expect(visited.size).toBeGreaterThan(15);
  for (const expectedPath of ["/app", "/app/library", "/app/vault", "/app/groups", "/app/campaigns", "/app/worlds", `/app/worlds/${worldId}`, `/app/worlds/${worldId}/wiki`, `/app/campaigns/${campaignId}`, `/app/campaigns/${campaignId}/vtt`]) {
    expect(visited.has(expectedPath), `Rota esperada não foi alcançada pelo crawler: ${expectedPath}`).toBe(true);
  }
});
