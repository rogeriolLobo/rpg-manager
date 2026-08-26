import type { Page } from "@playwright/test";

/**
 * Obtém o formulário de cena na página de Preparação de Aventura.
 */
export function getAdventureSceneForm(page: Page) {
  return page.locator("form").filter({ hasText: "Nova cena" });
}

/**
 * Obtém o formulário de cena na tela principal do VTT.
 */
export function getVttSceneForm(page: Page) {
  // Poderia usar id #vtt-scene-form se for adicionado no componente, por ora usamos o locator estrutural
  return page.locator("form").filter({ hasText: "Nova cena" });
}
