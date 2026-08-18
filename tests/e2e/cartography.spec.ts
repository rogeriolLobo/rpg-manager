import { expect, test } from "@playwright/test";

// F-002 (Cartografia): fluxo real pela UI — criar World, adicionar um mapa, adicionar um pin,
// ver o pin no mapa, remover o pin.
test("World → Cartografia → criar mapa → adicionar pin → ver e remover", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `e2e-cartography-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Cartógrafo de Teste");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("Sistema de Mapas");
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Sistema de Mapas" })).toBeVisible();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill("Terras Cartografadas");
  await page.getByLabel("RPG padrão").selectOption({ label: "Sistema de Mapas" });
  await page.getByLabel("Descrição").fill("Mundo de teste.");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Terras Cartografadas" })).toBeVisible();

  if ((page.viewportSize()?.width ?? 1000) <= 850) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Cartografia" }).click();
  await expect(page.getByRole("heading", { name: "Mapas do World" })).toBeVisible();

  await page.getByLabel("Título", { exact: true }).fill("Mapa da Capital");
  await page.getByLabel("URL da imagem").fill("https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg");
  await page.getByRole("button", { name: "Adicionar mapa" }).click();
  await expect(page.getByText("Mapa da Capital")).toBeVisible();
  await page.getByText("Mapa da Capital").click();

  await expect(page.getByRole("heading", { name: "Mapa da Capital" })).toBeVisible();
  await page.getByLabel("Rótulo").fill("Praça Central");
  await page.getByLabel("X (%)").fill("30");
  await page.getByLabel("Y (%)").fill("40");
  await page.getByRole("button", { name: "Adicionar pin" }).click();

  const pinButton = page.getByRole("button", { name: "Pin: Praça Central" });
  await expect(pinButton).toBeVisible();
  await pinButton.click();
  await expect(page.getByRole("heading", { name: "Praça Central" })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remover pin" }).click();
  await expect(page.getByRole("button", { name: "Pin: Praça Central" })).toHaveCount(0);
});
