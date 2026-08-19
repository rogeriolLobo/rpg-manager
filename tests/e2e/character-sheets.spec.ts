import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

// F-020 (BATCH9): Character Sheet Engine base — ver src/server/routes/sheets.ts.
// F-021 (BATCH11): Fichas em PDF — ver src/client/pdf/sheet-pdf.ts.
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

test("Ficha de personagem: cria modelo, vincula a um Personagem, valida campos e edita", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  await register(page, `e2e-sheet-owner-${suffix}@example.com`, `Dono Ficha ${suffix}`);

  await page.goto("/app/sheets");
  // F-023: seletor de Game System presente e habilitado por padrão (mutuamente exclusivo
  // com World — cobertura de compatibilidade fica nos testes de integração).
  await expect(page.getByLabel("Game System (opcional)")).toBeEnabled();
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

// Gera um PDF mínimo, só em memória (nunca hospedado por nós), com um campo AcroForm de
// texto — usado para provar que a detecção/preenchimento reais funcionam no navegador,
// sem depender de um PDF real na internet (page.route intercepta o fetch do navegador).
async function buildTestPdf(fieldName: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const field = form.createTextField(fieldName);
  field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  return doc.save();
}

test("Ficha de personagem: vincula PDF ao modelo, detecta campo AcroForm, mapeia e baixa a ficha preenchida", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const pdfUrl = "https://example.com/ficha-teste.pdf";
  const pdfBytes = await buildTestPdf("campo_conceito");
  await page.route(pdfUrl, (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from(pdfBytes) }));

  await register(page, `e2e-sheet-pdf-${suffix}@example.com`, `Dono PDF ${suffix}`);

  await page.goto("/app/sheets");
  await page.getByLabel("Nome").fill(`Modelo PDF ${suffix}`);
  await page.getByLabel("Chave").fill("conceito");
  await page.getByLabel("Rótulo").fill("Conceito");
  await page.getByLabel("URL do PDF (https)").fill(pdfUrl);
  await page.getByRole("button", { name: "Detectar campos do PDF" }).click();
  await expect(page.getByText("1 campo(s) detectado(s)")).toBeVisible();
  await page.getByLabel("Mapeamento no PDF").selectOption("ACROFORM");
  await page.getByLabel("Nome do campo no PDF").fill("campo_conceito");
  await page.getByRole("button", { name: "Criar modelo" }).click();
  await expect(page.getByText(`Modelo PDF ${suffix}`)).toBeVisible();
  await expect(page.getByText(/PDF vinculado/u)).toBeVisible();

  await page.goto("/app/vault/new?type=CHARACTER");
  await page.getByLabel("Nome", { exact: true }).fill(`Herói PDF ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await page.getByRole("link", { name: "Vincular ficha" }).click();
  await page.getByLabel("Modelo").selectOption({ label: `Modelo PDF ${suffix} (global)` });
  await page.getByLabel("Conceito").fill("Cartógrafa exilada");
  await page.getByRole("button", { name: "Salvar ficha" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar PDF preenchido" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ficha-.*\.pdf$/u);
});
