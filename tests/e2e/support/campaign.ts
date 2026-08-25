import type { Page } from "@playwright/test";

/**
 * Abre a Mesa do Mestre escopando o click ao header da página da campanha.
 */
export async function openGmTable(page: Page) {
  await page.locator(".page-header").getByRole("link", { name: "Mesa do Mestre", exact: true }).click();
}
