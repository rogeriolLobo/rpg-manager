import { expect, test, type Page } from "@playwright/test";

// LIB-005: upload de capa (Zero Cost — Workers KV) pela UI real — página de
// detalhe do RPG. PNG mínimo válido (1x1 transparente, 67 bytes) — precisa ser
// uma imagem de verdade (não só "magic bytes") porque o cliente decodifica via
// createImageBitmap antes de reenviar (ver processCoverImage em
// src/client/pages/library-pages.tsx); bytes truncados falhariam na decodificação
// do navegador antes mesmo de chegar ao servidor.
const MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function registerAndCreateRpg(page: Page, email: string, title: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Capa Upload");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("upload de capa: enviar, ver preview atualizado, trocar e remover — sem tocar na URL externa", async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndCreateRpg(page, `e2e-cover-upload-${Date.now()}@example.com`, "RPG Capa Upload");

  // Estado inicial: sem capa nenhuma, botão "Enviar capa" disponível.
  await expect(page.getByText("Enviar capa")).toBeVisible();
  await expect(page.locator(".cover-placeholder")).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "capa.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") });

  // Sucesso: o botão vira "Trocar capa", "Remover capa" aparece, e a <img> real substitui o placeholder.
  await expect(page.getByText("Trocar capa")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover capa" })).toBeVisible();
  const cover = page.locator(".book-cover.large img");
  await expect(cover).toBeVisible();
  await expect(cover).toHaveAttribute("src", /\/api\/v1\/media\/covers\//u);

  // Trocar a capa: novo upload continua funcionando (Trocar capa permanece visível).
  await fileInput.setInputFiles({ name: "capa-2.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") });
  await expect(page.getByText("Trocar capa")).toBeVisible();

  // Remover: confirma o diálogo nativo, volta ao placeholder.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remover capa" }).click();
  await expect(page.getByText("Enviar capa")).toBeVisible();
  await expect(page.locator(".cover-placeholder")).toBeVisible();
});

test("upload de capa não interfere na edição da URL externa (fluxos independentes)", async ({ page }) => {
  test.setTimeout(60_000);
  await registerAndCreateRpg(page, `e2e-cover-upload-external-${Date.now()}@example.com`, "RPG Capa Upload e URL");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "capa.png", mimeType: "image/png", buffer: Buffer.from(MINIMAL_PNG_BASE64, "base64") });
  await expect(page.getByText("Trocar capa")).toBeVisible();

  // Editar o RPG (formulário principal) e salvar sem tocar em nada continua funcionando
  // normalmente mesmo com uma capa por upload presente (regressão: LIB-001/CLAUDE.md §18).
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue("");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Capa Upload e URL" })).toBeVisible();

  // A capa enviada continua exibida — o save do formulário principal não a apagou.
  await expect(page.locator(".book-cover.large img")).toHaveAttribute("src", /\/api\/v1\/media\/covers\//u);
});
