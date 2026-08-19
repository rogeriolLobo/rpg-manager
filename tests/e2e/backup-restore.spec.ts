import { expect, test } from "@playwright/test";

// F-015: Backup/Restore completo — fluxo principal pela UI real de Configurações
// (Baixar backup → Restaurar backup: prévia → confirmar). O download é obtido via
// requisição autenticada no mesmo contexto do navegador (mesma sessão/cookies já
// usadas pela página), não um clique+download real — evita complexidade de
// download de arquivo no Playwright sem abrir mão de exercitar a API real.
test("F-015: restaurar um backup completo pela tela de Configurações", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `e2e-backup-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Narrador Backup");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome", { exact: true }).fill("Mundo do Backup");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Mundo do Backup" })).toBeVisible();

  const backupResponse = await page.request.get("/api/v1/export");
  expect(backupResponse.status()).toBe(200);
  const backupText = await backupResponse.text();

  await page.goto("/app/settings");
  const restoreSection = page.locator("section").filter({ hasText: "Restaurar backup" });
  await restoreSection.locator('input[name="backup"]').setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backupText, "utf-8") });
  await restoreSection.getByRole("button", { name: "Gerar prévia" }).click();
  await expect(restoreSection.getByText(/Worlds: 1/u)).toBeVisible();
  await restoreSection.getByRole("button", { name: "Confirmar restore" }).click();
  await expect(restoreSection.getByText(/Restaurado:/u)).toBeVisible();

  // O World original continua intacto e agora existe uma 2ª cópia restaurada — nada foi
  // sobrescrito nem destruído.
  await page.goto("/app/worlds");
  await expect(page.getByText("Mundo do Backup")).toHaveCount(2);
});
