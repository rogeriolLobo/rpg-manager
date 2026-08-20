import { defineConfig, devices } from '@playwright/test';

process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

export default defineConfig({
  testDir: './tests/e2e',
  // RPG-1.0-BATCH5: aquece worker+D1 com uma chamada real ANTES de qualquer teste cronometrado
  // (não é um timeout cego — ver tests/e2e/global-setup.ts e docs/e2e/LOCAL_E2E_DIAGNOSTICS.md).
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  // LIB-003: 1 worker só no CI — causa raiz de dois flakes recorrentes
  // (RATE_LIMIT em AUTH_REGISTRATION_RATE_LIMITER e SQLITE_BUSY no D1 local)
  // era o mesmo: 2 workers do Playwright, cada um registrando contas e
  // escrevendo no MESMO arquivo SQLite local em paralelo, estourando o rate
  // limiter compartilhado e disputando lock do arquivo. `fullyParallel:false`
  // só serializa testes DENTRO de um arquivo — arquivos/projetos ainda corriam
  // em paralelo entre si. workers:1 serializa tudo (poucos testes, poucos
  // minutos a mais, elimina as duas classes de flake na raiz em vez de
  // reruns repetidos). Local mantém o paralelismo padrão (não é o gate real).
  workers: process.env.CI ? 1 : undefined,
  // Um retry só no CI: mais barato que um re-run do workflow inteiro (que refaz
  // npm ci, lint, typecheck, unit, integration, build antes de chegar no E2E) e
  // absorve timing induzido por runner compartilhado sem mascarar bug real.
  retries: process.env.CI ? 1 : 0,
  // Timeout de asserção um pouco mais folgado que o padrão (5s) para reduzir
  // falso-positivo por contenção de CPU no runner do GitHub Actions.
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  // BATCH19: causa raiz real do flake recorrente de vault-worlds-flow.spec.ts, encontrada com
  // evidência real (primeira vez que o CI subiu screenshot como artifact, ver
  // .github/workflows/ci.yml) — os screenshots da falha mostravam a TELA DE UM TESTE ANTERIOR
  // (player-view.spec.ts), nunca a de vault-worlds-flow, e "waiting for getByLabel('Nome')"
  // nunca resolvia nem chegava a logar retry — sintoma clássico de um processo de renderer do
  // Chromium morto/travado deixando a última pintura de tela de ANTES do crash, não de um
  // elemento lento/instável. Causa raiz documentada do Chromium em containers Docker: o
  // /dev/shm padrão do GitHub Actions (64MB) é pequeno demais para uma fila longa de testes
  // sequenciais, causando crash do processo de renderer sob pressão de memória.
  // `--disable-dev-shm-usage` faz o Chromium usar /tmp em vez de /dev/shm — a recomendação
  // oficial do Playwright/Puppeteer para exatamente este ambiente, sem custo/risco em
  // desenvolvimento local (só evita um caminho de memória compartilhada que já não é limitado
  // fora de um container).
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { args: ['--disable-dev-shm-usage'] } },
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
