import type { Page } from "@playwright/test";

/**
 * Clica em um link global específico da sidebar principal (evita colisão com links homônimos no conteúdo).
 */
export async function openSidebarLink(page: Page, linkName: string) {
  await page.locator(".sidebar").getByRole("link", { name: linkName, exact: true }).click();
}
