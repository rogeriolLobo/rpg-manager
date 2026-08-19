import { expect, test } from "@playwright/test";

// F-028 (BATCH15): Files/Handouts/Assets — anexo genérico numa Vault Entity — ver
// src/server/routes/files.ts.
const MINIMAL_JPEG_BASE64 = "/9j/4AAQSkZJRgAB"; // header JPEG mínimo válido (magic bytes).

test("Vault: envia um anexo (imagem) à entidade, baixa e depois remove", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Dono Anexo ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-file-asset-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill(`Local com Mapa ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Local com Mapa ${suffix}` })).toBeVisible();

  await expect(page.getByText("Nenhum anexo ainda.")).toBeVisible();
  await page.getByLabel(/Enviar arquivo/u).setInputFiles({
    name: "mapa.jpg", mimeType: "image/jpeg", buffer: Buffer.from(MINIMAL_JPEG_BASE64, "base64"),
  });
  await expect(page.getByRole("link", { name: /mapa\.jpg/u })).toBeVisible();

  await page.getByRole("button", { name: "Excluir anexo mapa.jpg" }).click();
  await expect(page.getByText("Nenhum anexo ainda.")).toBeVisible();
});
