import { expect, test } from "@playwright/test";

// F-034 (GM View integrada): liga a preparação da Adventure (F-025) e os anexos/handouts
// (F-028) direto na tela do VTT — ver src/client/pages/vtt-pages.tsx.
const MINIMAL_JPEG_BASE64 = "/9j/4AAQSkZJRgAB"; // mesmo header mínimo usado em file-assets.spec.ts

test("VTT — GM View: preparação da Adventure aparece na tela, com link para o editor completo e anexos inline", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Mestre GM View ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-gmview-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  // Adventure com uma cena e um handout revelado.
  await page.goto("/app/vault/new?type=ADVENTURE");
  await page.getByLabel("Nome", { exact: true }).fill(`Aventura GM View ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Aventura GM View ${suffix}` })).toBeVisible();
  await page.getByRole("link", { name: "Preparar aventura" }).click();
  const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
  await sceneForm.getByLabel("Título").fill("Cena 1");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByText("Cena 1").first()).toBeVisible();
  const handoutForm = page.locator("form").filter({ hasText: "Novo handout" });
  await handoutForm.getByLabel("Título").fill("Bilhete do Barão");
  await handoutForm.getByLabel("Conteúdo").fill("Venha imediatamente.");
  await page.getByRole("button", { name: "Criar handout" }).click();
  await expect(page.getByText("Bilhete do Barão")).toBeVisible();
  await page.getByRole("button", { name: "Revelar" }).click();
  await expect(page.getByText("revelado aos jogadores")).toBeVisible();

  // RPG + campanha usando essa Adventure como principal.
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`RPG GM View ${suffix}`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `RPG GM View ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Criar campanha" }).click();
  await expect(page.getByLabel("RPG")).toHaveValue(/.+/u, { timeout: 30_000 });
  await page.getByLabel("Nome da campanha").fill(`Mesa GM View ${suffix}`);
  await page.getByLabel("Adventure principal").selectOption({ label: `Aventura GM View ${suffix}` });
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa GM View ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
  await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible();
  await expect(page.getByText("Preparação da Adventure")).toBeVisible();
  await expect(page.getByText(`Aventura GM View ${suffix}`)).toBeVisible();
  await expect(page.getByText("1 cena (0 concluídas) · 1/1 handouts revelados")).toBeVisible();

  // Anexo inline (F-028) direto na tela do VTT, sem sair para o Vault.
  await expect(page.getByText("Nenhum anexo ainda.")).toBeVisible();
  await page.getByLabel(/Enviar arquivo/u).setInputFiles({
    name: "mapa.jpg", mimeType: "image/jpeg", buffer: Buffer.from(MINIMAL_JPEG_BASE64, "base64"),
  });
  await expect(page.getByRole("link", { name: /mapa\.jpg/u })).toBeVisible();

  await page.getByRole("link", { name: "Abrir preparação completa" }).click();
  await expect(page.getByRole("heading", { name: `Aventura GM View ${suffix}` })).toBeVisible();
});
