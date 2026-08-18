import { expect, test } from "@playwright/test";

// F-003 (External Resources): fluxo real pela UI — criar World, adicionar um recurso externo,
// confirmar que aparece na lista com o link correto.
test("World → Recursos externos → adicionar link → aparece na lista", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `e2e-extres-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Narrador Recursos");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("Sistema de Recursos");
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Sistema de Recursos" })).toBeVisible();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill("Reino Distante");
  await page.getByLabel("RPG padrão").selectOption({ label: "Sistema de Recursos" });
  await page.getByLabel("Descrição").fill("Mundo de teste.");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Reino Distante" })).toBeVisible();

  if ((page.viewportSize()?.width ?? 1000) <= 850) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Recursos externos" }).click();
  await expect(page.getByRole("heading", { name: "Novo recurso externo" })).toBeVisible();
  await page.getByLabel("Título", { exact: true }).fill("Mapa oficial do Reino");
  await page.getByLabel("URL").fill("https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg");
  await page.getByLabel("Tipo").selectOption("MAP");
  await page.getByRole("button", { name: "Adicionar recurso" }).click();

  const link = page.getByRole("link", { name: /Mapa oficial do Reino/u });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg");

  // Remover funciona.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remover Mapa oficial do Reino" }).click();
  await expect(page.getByText("Nenhum recurso externo ainda")).toBeVisible();
});
