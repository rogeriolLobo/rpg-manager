import { expect, test, type Page } from "@playwright/test";

// F-020 (BATCH9): Character Sheet Engine base — ver src/server/routes/sheets.ts.
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

const isMobileViewport = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 850;
const openNav = async (page: Page) => { if (isMobileViewport(page)) await page.getByRole("button", { name: "Abrir menu" }).click(); };

test("Ficha de personagem: cria modelo, vincula a um Personagem, valida campos e edita", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  await register(page, `e2e-sheet-owner-${suffix}@example.com`, `Dono Ficha ${suffix}`);

  await page.goto("/app/sheets");
  await page.getByLabel("Nome").fill(`Modelo Neutro ${suffix}`);
  // Primeiro campo (TEXT, já presente por padrão).
  await page.getByLabel("Chave").fill("conceito");
  await page.getByLabel("Rótulo").fill("Conceito");
  await page.getByLabel("Obrigatório").check();
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  const fields = page.locator(".template-field");
  await fields.nth(1).getByLabel("Chave").fill("postura");
  await fields.nth(1).getByLabel("Rótulo").fill("Postura");
  await fields.nth(1).getByLabel("Tipo").selectOption("CHOICE");
  await fields.nth(1).getByLabel(/Opções/u).fill("Cautelosa, Ousada");
  await page.getByRole("button", { name: "Criar modelo" }).click();
  await expect(page.getByText(`Modelo Neutro ${suffix}`)).toBeVisible();

  await page.goto("/app/vault/new?type=CHARACTER");
  await page.getByLabel("Nome", { exact: true }).fill(`Herói ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Herói ${suffix}` })).toBeVisible();

  await expect(page.getByText("Nenhuma ficha vinculada.")).toBeVisible();
  await page.getByRole("link", { name: "Vincular ficha" }).click();
  await expect(page.getByRole("heading", { name: `Herói ${suffix}` })).toBeVisible();
  await page.getByLabel("Modelo").selectOption({ label: `Modelo Neutro ${suffix} (global)` });

  // Sem preencher os campos obrigatórios: erro em cada campo específico.
  await page.getByRole("button", { name: "Salvar ficha" }).click();
  await expect(page.getByText("Campo obrigatório.").first()).toBeVisible();

  await page.getByLabel("Conceito *").fill("Cartógrafa exilada");
  await page.getByLabel("Postura").selectOption("Ousada");
  await page.getByRole("button", { name: "Salvar ficha" }).click();

  await expect(page.getByRole("heading", { name: `Herói ${suffix}` })).toBeVisible();
  await expect(page.getByText(`Modelo: Modelo Neutro ${suffix}`)).toBeVisible();
  await expect(page.getByText("Cartógrafa exilada")).toBeVisible();
  await expect(page.getByText("Ousada")).toBeVisible();

  // Reabrir a edição já vem preenchido, e é possível remover a ficha.
  await page.getByRole("link", { name: "Editar ficha" }).click();
  await expect(page.getByLabel("Conceito *")).toHaveValue("Cartógrafa exilada");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remover ficha" }).click();
  await expect(page.getByText("Nenhuma ficha vinculada.")).toBeVisible();
});
