import { defineConfig, devices } from '@playwright/test';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Um retry só no CI: mais barato que um re-run do workflow inteiro (que refaz
  // npm ci, lint, typecheck, unit, integration, build antes de chegar no E2E) e
  // absorve timing induzido por runner compartilhado sem mascarar bug real.
  retries: process.env.CI ? 1 : 0,
  // Timeout de asserção um pouco mais folgado que o padrão (5s) para reduzir
  // falso-positivo por contenção de CPU no runner do GitHub Actions.
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run db:migrate:local && npm run dev',
    url: 'http://127.0.0.1:5173/login',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
