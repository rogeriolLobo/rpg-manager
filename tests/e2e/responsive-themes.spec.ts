import { expect, test, type Page } from "@playwright/test";

// BATCH26 do pedido de finalização — Seções 26 (responsivo) e 27 (temas). Uma jornada única,
// deterministica e isolada (não dezenas de microtests) cobrindo as rotas mínimas citadas
// (Dashboard/Campaigns/One-Shot/Player View/GM View/VTT/Sheets/Social/Settings-Backup) em:
//
// 1) Todos os 5 breakpoints pedidos (1440/1024/768/390/375), detectando overflow horizontal
//    global (`scrollWidth > clientWidth` em documentElement/body) — nunca teste de pixel exato,
//    só a invariante estrutural pedida.
// 2) Light/Dark/System (explícito via Configurações + emulateMedia para o caso "Sistema"),
//    confirmando render/sem crash em cada página — deliberadamente NÃO um teste de contraste
//    pixel-perfect (a própria Seção 27 pede exatamente isso: "não fazer pixel-perfect brittle
//    test").
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

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "1024", width: 1024, height: 900 },
  { label: "768", width: 768, height: 1024 },
  { label: "390", width: 390, height: 844 },
  { label: "375", width: 375, height: 812 },
];

interface RouteUnderTest { label: string; path: string; heading: string }

test("Responsivo (5 breakpoints, Seção 26) e Temas (Light/Dark/System, Seção 27): sem overflow horizontal, sem crash", async ({ page }) => {
  test.setTimeout(300_000);
  const suffix = Date.now();
  await register(page, `e2e-responsive-owner-${suffix}@example.com`, `Responsivo ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG Responsivo ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa Responsivo ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(csrf), data: { title: "Cena Responsivo", mapId: null, imageUrl: "https://example.com/responsive.png", notes: "" } });
  const oneShotResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa Única Responsivo ${suffix}`, status: "PREPARING", sessionMode: "ONE_SHOT", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(oneShotResponse.status()).toBe(201);
  const oneShotId = ((await oneShotResponse.json()) as { item: { id: string } }).item.id;

  const routes: RouteUnderTest[] = [
    { label: "Dashboard", path: "/app", heading: "Painel do aventureiro" },
    { label: "Campaigns", path: "/app/campaigns", heading: "Planejador de mesas" },
    { label: "One-Shot", path: `/app/campaigns/${oneShotId}`, heading: `Mesa Única Responsivo ${suffix}` },
    { label: "Player View", path: `/app/campaigns/${campaignId}/vtt/live`, heading: "Aguardando o mestre" },
    { label: "GM View", path: `/app/campaigns/${campaignId}`, heading: `Mesa Responsivo ${suffix}` },
    { label: "VTT", path: `/app/campaigns/${campaignId}/vtt`, heading: "VTT — cenas e tokens" },
    { label: "Sheets", path: "/app/sheets", heading: "Modelos de ficha" },
    { label: "Social", path: "/app/friends", heading: "Amigos" },
    { label: "Settings/Backup", path: "/app/settings", heading: "Aparência, dados e portabilidade" },
  ];

  // ---- Seção 26: overflow horizontal global em cada breakpoint x rota. ----
  const overflowViolations: string[] = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible({ timeout: 15_000 });
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      // Margem de 1px: subpixel rendering pode arredondar diferente entre scrollWidth/clientWidth
      // sem ser overflow real.
      if (overflow.doc > 1 || overflow.body > 1) {
        overflowViolations.push(`${viewport.label}px @ ${route.label} (${route.path}): documentElement overflow=${overflow.doc}px, body overflow=${overflow.body}px`);
      }
    }
  }
  expect(overflowViolations, `Overflow horizontal encontrado:\n${overflowViolations.join("\n")}`).toHaveLength(0);

  // ---- Seção 27: Light/Dark explícitos (Configurações) + System (emulateMedia) — sem crash em
  // nenhuma das rotas, em viewport desktop (o overflow por breakpoint já foi coberto acima). ----
  await page.setViewportSize({ width: 1440, height: 900 });
  const crashViolations: string[] = [];
  const assertNoCrash = async (themeLabel: string, route: RouteUnderTest) => {
    await page.goto(route.path);
    // toBeVisible() com retry (nunca isVisible() puro, que retorna na hora e não espera o fetch/
    // mount terminar) é quem decide se a página realmente renderizou.
    let headingVisible = true;
    try {
      await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible({ timeout: 15_000 });
    } catch {
      headingVisible = false;
    }
    const errorBoundaryVisible = await page.getByRole("heading", { name: "O grimório encontrou um erro." }).isVisible();
    if (!headingVisible || errorBoundaryVisible) {
      crashViolations.push(`${themeLabel} @ ${route.label} (${route.path}): heading visível=${headingVisible}, crash=${errorBoundaryVisible}`);
    }
  };

  await page.goto("/app/settings");
  await page.getByRole("radio", { name: /Claro/u }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const route of routes) await assertNoCrash("Light", route);

  await page.goto("/app/settings");
  await page.getByRole("radio", { name: /Escuro/u }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const route of routes) await assertNoCrash("Dark", route);

  // "Sistema" (ThemePreference SYSTEM) sempre resolve para um data-theme concreto ("light" ou
  // "dark", nunca ausente — ver applyTheme em theme/theme.ts, decisão de produto real desta
  // base de código, diferente de outras convenções onde "system" significa atributo ausente).
  // O que importa aqui é que o valor RESOLVIDO acompanha o `prefers-color-scheme` do SO.
  await page.goto("/app/settings");
  await page.getByRole("radio", { name: /Sistema/u }).check();
  await expect(page.getByRole("radio", { name: /Sistema/u })).toBeChecked();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const route of routes) await assertNoCrash("System (dark)", route);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const route of routes) await assertNoCrash("System (light)", route);

  expect(crashViolations, `Crash/render ausente por tema:\n${crashViolations.join("\n")}`).toHaveLength(0);
});
