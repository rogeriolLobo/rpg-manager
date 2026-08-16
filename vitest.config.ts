import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // url-import.ts fica de fora: a parte com cobertura significativa (fetch
      // com SSRF revalidado a cada redirect, extração via HTMLRewriter) só roda
      // de verdade no runtime real de Workers (tests/integration, sem HTMLRewriter
      // disponível no ambiente node/jsdom deste config) — a parte pura
      // (`validateImportUrl`) tem sua própria suíte dedicada
      // (tests/unit/url-import.test.ts), só não conta para este threshold global.
      include: ['src/domain/**/*.ts', 'src/server/security/{crypto,headers,cover-images}.ts', 'src/shared/{validation,security}/**/*.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});
