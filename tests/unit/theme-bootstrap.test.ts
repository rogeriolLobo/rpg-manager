import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("bootstrap de tema", () => {
  it("carrega como script externo bloqueante antes da aplicação", () => {
    const indexHtml = readFileSync(
      resolve(process.cwd(), "index.html"),
      "utf8",
    );
    const bootstrapTag = '<script src="/theme-bootstrap.js"></script>';
    const applicationTag =
      '<script type="module" src="/src/client/main.tsx"></script>';

    expect(indexHtml).toContain(bootstrapTag);
    expect(indexHtml.indexOf(bootstrapTag)).toBeLessThan(
      indexHtml.indexOf(applicationTag),
    );
    expect(bootstrapTag).not.toMatch(/\b(?:async|defer)\b/u);
  });
});
