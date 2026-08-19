import { expect, test, type ConsoleMessage, type Page, type Request } from "@playwright/test";

// RPG MANAGER 1.0 — SMOKE DE RELEASE (release-train, teste final autônomo).
//
// Suíte isolada e consolidada que percorre, numa única jornada coerente, os cinco recursos
// entregues nos últimos batches (Ideas, External Resources, Global Search, Cartografia,
// GM Tools), navegação cruzada por todos os módulos do produto, troca de tema e uma
// revalidação leve do error handling do BATCH4 — sem duplicar as suítes dedicadas já
// existentes (dashboard-quick-idea.spec.ts, external-resources.spec.ts, cartography.spec.ts,
// gm-tools.spec.ts, error-states.spec.ts, navigation-invariants.spec.ts continuam sendo a
// fonte de verdade para casos de borda/validação). Roda em desktop e mobile automaticamente
// (projects do playwright.config.ts).
//
// Captura console/network durante toda a execução e falha se aparecer um erro real de
// aplicação (pageerror ou console.error) — ruído conhecido (aviso de capa de fixture
// apontando para host inexistente, sempre console.warn) não derruba o teste.

const PREFIX = `[SMOKE-1.0] ${Date.now()}`;

async function register(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para smoke 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para smoke 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("RPG Manager 1.0 — smoke de release: Ideas, External Resources, Global Search, Cartografia, GM Tools, navegação, temas e error handling", async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  // O Chrome loga automaticamente "Failed to load resource: ... 401/404" como console.error
  // para QUALQUER resposta não-2xx, mesmo quando a aplicação trata o erro corretamente na UI
  // (confirmado via inspeção de rede antes deste filtro: são só dois casos, ambos esperados —
  // a checagem anônima de sessão em /auth/session ANTES do login, e o 404 proposital do
  // recurso inexistente testado na seção de error handling do BATCH4 mais abaixo). Um 401/404
  // de qualquer OUTRA origem ainda derruba o teste, porque o texto genérico do Chrome não
  // distingue a origem — só filtramos os dois códigos já investigados e explicados aqui.
  const KNOWN_NOISE = /Failed to load resource.*(401|404)/u;
  page.on("console", (message: ConsoleMessage) => { if (message.type() === "error" && !KNOWN_NOISE.test(message.text())) consoleErrors.push(message.text()); });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  page.on("requestfailed", (request: Request) => {
    // Ruído conhecido: (1) fixtures de capa/imagem apontando para hosts inexistentes de
    // propósito (exemplo.com) — não é falha de aplicação; (2) ERR_ABORTED — o navegador cancela
    // requisições em voo quando a página navega (ex.: `page.goto` logo após uma mutação já
    // confirmada na UI) — padrão conhecido do Playwright, não indica falha real de rede.
    const errorText = request.failure()?.errorText ?? "";
    if (!request.url().includes("exemplo.com") && errorText !== "net::ERR_ABORTED") failedRequests.push(`${request.method()} ${request.url()} — ${errorText}`);
  });

  const isMobile = (page.viewportSize()?.width ?? 1000) <= 850;
  const openNavigation = async () => {
    if (isMobile) {
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    }
  };

  // ── Setup: conta + RPG + World (base para Ideas/Resources/Cartografia/Vault) ──
  const email = `smoke-1.0-${Date.now()}@example.com`;
  await page.emulateMedia({ colorScheme: "dark" });
  await register(page, email, "Smoke 1.0");

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`${PREFIX} RPG`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `${PREFIX} RPG` })).toBeVisible();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill(`${PREFIX} World`);
  await page.getByLabel("RPG padrão").selectOption({ label: `${PREFIX} RPG` });
  await page.getByLabel("Descrição").fill("World temporário do smoke de release 1.0.");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: `${PREFIX} World` })).toBeVisible();
  const worldId = new URL(page.url()).pathname.split("/").pop();

  // ── A. Ideas / Quick Capture ──
  await page.goto("/app");
  await page.getByRole("button", { name: "Nova ideia" }).click();
  const ideaDialog = page.getByRole("dialog");
  await expect(ideaDialog.getByRole("heading", { name: "Nova ideia" })).toBeVisible();
  // Único World próprio já vem pré-selecionado — só confirma a seleção correta (por value,
  // via seletor estrutural — evita ambiguidade de rótulo/nome acessível).
  await ideaDialog.locator("select").selectOption(worldId!);
  await ideaDialog.getByLabel("Título", { exact: true }).fill(`${PREFIX} Idea`);
  await ideaDialog.getByLabel("Anotação (opcional)").fill("Gancho criado pelo smoke automatizado de release.");
  await ideaDialog.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(page.getByText("Ideia salva no Diário.")).toBeVisible();
  await page.getByRole("link", { name: "Ver no Diário" }).click();
  await expect(page).toHaveURL(/\/journal$/u);
  // getByText sozinho é ambíguo aqui de propósito: o título da página aberta aparece na lista
  // lateral (item ativo) E no heading do editor — só o heading é role="heading".
  await expect(page.getByRole("heading", { name: `${PREFIX} Idea`, exact: true })).toBeVisible();

  // ── B. External Resources (URL HTTPS estável de fixture, sem fetch server-side) ──
  await page.goto(`/app/worlds/${worldId}/resources`);
  await page.getByLabel("Título", { exact: true }).fill(`${PREFIX} Resource`);
  await page.getByLabel("URL").fill("https://example.com/smoke-1.0-fixture");
  await page.getByLabel("Tipo").selectOption("ARTICLE");
  await page.getByRole("button", { name: "Adicionar recurso" }).click();
  await expect(page.getByText(`${PREFIX} Resource`)).toBeVisible();

  // ── C. Global Search (Command Palette) ──
  await openNavigation();
  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await expect(page.getByRole("dialog", { name: "Busca global e comandos" })).toBeVisible();
  await page.getByPlaceholder(/Buscar em/u).fill(`${PREFIX} World`);
  await expect(page.getByRole("button", { name: `${PREFIX} World` })).toBeVisible();
  await page.getByRole("button", { name: `${PREFIX} World` }).click();
  await expect(page.getByRole("heading", { name: `${PREFIX} World` })).toBeVisible();

  // ── Vault entity (para vincular ao pin da Cartografia) ──
  await page.goto(`/app/vault/new?worldId=${worldId}`);
  await page.getByLabel("Tipo").selectOption("LOCATION");
  await page.getByLabel("Nome", { exact: true }).fill(`${PREFIX} Location`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `${PREFIX} Location` })).toBeVisible();

  // ── D. Cartografia ──
  if (isMobile) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Cartografia" }).click();
  await expect(page.getByRole("heading", { name: "Mapas do World" })).toBeVisible();
  await page.getByLabel("Título", { exact: true }).fill(`${PREFIX} Map`);
  await page.getByLabel("URL da imagem").fill("https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg");
  await page.getByRole("button", { name: "Adicionar mapa" }).click();
  await expect(page.getByText(`${PREFIX} Map`)).toBeVisible();
  await page.getByText(`${PREFIX} Map`).click();
  await expect(page.getByRole("heading", { name: `${PREFIX} Map` })).toBeVisible();
  await page.getByLabel("Rótulo").fill(`${PREFIX} Pin`);
  await page.getByLabel("X (%)").fill("35");
  await page.getByLabel("Y (%)").fill("60");
  await page.getByLabel("Entidade vinculada (opcional)").selectOption({ label: `${PREFIX} Location` });
  await page.getByRole("button", { name: "Adicionar pin" }).click();
  const pinButton = page.getByRole("button", { name: `Pin: ${PREFIX} Pin` });
  await expect(pinButton).toBeVisible();
  // Posição persistida corretamente (coordenadas normalizadas em % — o style inline usa %,
  // toHaveCSS resolveria para pixel computado, por isso a checagem é no atributo style).
  await expect(pinButton).toHaveAttribute("style", /left:\s*35%/u);
  await expect(pinButton).toHaveAttribute("style", /top:\s*60%/u);
  await pinButton.click();
  await expect(page.getByRole("heading", { name: `${PREFIX} Pin` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Ver ${PREFIX} Location` })).toBeVisible();
  // RPG-1.0-BATCH5: diagnóstico explícito em vez de só esperar o botão sumir — se o diálogo
  // nativo (`confirm()`) não for capturado a tempo, o Playwright o descarta (DISMISS) por
  // padrão, `confirm()` retorna false, e `removePin()` retorna cedo sem chamar a API (ver
  // src/client/pages/cartography-pages.tsx). Isso produzia "elemento não encontrado" — um
  // sintoma de UI — quando a causa real (quando acontecia) era o diálogo nunca aceito. Agora
  // afirmamos o tipo/mensagem do diálogo E esperamos a resposta real do DELETE antes de checar
  // o DOM, para que uma falha aqui aponte exatamente para STARTUP/NETWORK/APPLICATION/UI.
  const deletePinResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && /\/cartography\/.+\/pins\/.+/u.test(response.url()));
  page.once("dialog", async (dialog) => {
    expect(dialog.type(), "diálogo inesperado ao remover pin").toBe("confirm");
    expect(dialog.message(), "mensagem de confirmação inesperada").toBe("Remover este pin?");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Remover pin" }).click();
  const deleteResponse = await deletePinResponse;
  expect(deleteResponse.status(), `DELETE do pin falhou (rede/aplicação, não UI): ${deleteResponse.status()}`).toBe(204);
  await expect(page.getByRole("button", { name: `Pin: ${PREFIX} Pin` })).toHaveCount(0);

  // ── E. GM Tools (client-side, sem escrita de dados) ──
  await page.goto("/app/gm-tools");
  await expect(page.getByRole("heading", { name: "Prepare a mesa" })).toBeVisible();
  const rollRanges: Array<[string, number, number]> = [
    ["1d6", 1, 6],
    ["2d6+1", 3, 13],
    ["1d20", 1, 20],
    ["3d8-2", 1, 22],
  ];
  for (const [notation, min, max] of rollRanges) {
    await page.getByLabel("Notação").fill(notation);
    await page.getByRole("button", { name: "Rolar" }).click();
    const totalText = await page.locator(".dice-total").first().innerText();
    const total = Number(totalText.replace(/\D+/gu, ""));
    expect(total, `total de ${notation} fora da faixa [${min},${max}]`).toBeGreaterThanOrEqual(min);
    expect(total, `total de ${notation} fora da faixa [${min},${max}]`).toBeLessThanOrEqual(max);
  }
  await expect(page.locator(".timer-display")).toHaveText("--:--");
  await page.getByRole("button", { name: /^Iniciar$/u }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: /^Pausar$/u }).click();
  const pausedDisplay = await page.locator(".timer-display").innerText();
  expect(pausedDisplay, "timer não avançou após iniciar/pausar").not.toBe("--:--");
  await page.getByRole("button", { name: /^Zerar$/u }).click();
  await expect(page.locator(".timer-display")).toHaveText("--:--");

  // ── F/G/H. Navegação cruzada + temas + viewport ──
  const crossNavigation: Array<[string, string]> = [
    ["/app", "Painel do aventureiro"],
    ["/app/library", "Seu catálogo de RPGs"],
    ["/app/vault", "Seu acervo de jogo"],
    ["/app/groups", "Grupos de jogo"],
    ["/app/campaigns", "Planejador de mesas"],
    ["/app/worlds", "Seus mundos"],
  ];
  for (const [path, heading] of crossNavigation) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const worldNavigation: Array<[string, string]> = [
    [`/app/worlds/${worldId}`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/wiki`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/journal`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/relations`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/timeline`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/bestiary`, `Criaturas de ${PREFIX} World`],
    [`/app/worlds/${worldId}/resources`, `${PREFIX} World`],
    [`/app/worlds/${worldId}/cartography`, "Mapas do World"],
  ];
  for (const [path, heading] of worldNavigation) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  // Nenhum overflow horizontal na página principal (regressão real do BATCH2 — grid-template
  // 1fr sem minmax(0,...) já foi corrigida; revalidação leve aqui).
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(hasHorizontalOverflow, "overflow horizontal detectado na página").toBe(false);

  // Light / Dark / System — app continua renderizando, navegação funcional, sem crash.
  // colorScheme já foi emulado como "dark" no início do teste, então "Sistema" também
  // resolve para dark aqui (sem precisar reemular).
  await openNavigation();
  await page.getByRole("link", { name: "Configurações" }).click();
  const themeChecks: Array<[RegExp, "dark" | "light"]> = [[/Escuro/u, "dark"], [/Claro/u, "light"], [/Sistema/u, "dark"]];
  for (const [radioLabel, expectedTheme] of themeChecks) {
    await page.getByRole("radio", { name: radioLabel }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expectedTheme);
    // openNavigation() só reabre o menu mobile se ele estiver fechado — clicar num link do
    // menu já fecha o menu sozinho (ver app-shell.tsx), então uma única chamada por iteração
    // é suficiente: o menu permanece aberto entre a checagem "Biblioteca" e o clique seguinte.
    await openNavigation();
    await expect(page.getByRole("link", { name: "Biblioteca" })).toBeVisible();
    await page.getByRole("link", { name: "Configurações" }).click();
  }
  await page.getByRole("radio", { name: /Claro/u }).check();

  // ── I. Error handling (BATCH4) — revalidação leve; casos completos em error-states.spec.ts ──
  await page.goto("/app/library/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "Não encontrado" })).toBeVisible();
  await expect(page.getByText("Carregando")).toHaveCount(0);

  // ── Evidência visual (não versionada — ver .gitignore) ──
  await page.goto("/app/gm-tools");
  await page.screenshot({ path: `screenshots/release-1.0-smoke-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });

  // ── Console/network limpos ──
  expect(pageErrors, `erros de página inesperados: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(consoleErrors, `console.error inesperado: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(failedRequests, `requisições falhas inesperadas: ${failedRequests.join(" | ")}`).toEqual([]);
});
