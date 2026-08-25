import type { Page } from "@playwright/test";

/**
 * Obtém o select de vinculação de World, escopado ao formulário da entidade.
 */
export function getVaultWorldSelect(page: Page) {
  return page.locator("form").getByRole("combobox", { name: "World", exact: true });
}
