import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        ENVIRONMENT: 'test',
        E2E_BYPASS_RATE_LIMIT: '0',
        PASSWORD_PEPPER: 'integration-test-pepper-not-a-production-secret',
        TURNSTILE_SECRET_KEY: '',
      },
    },
  }))],
  test: { include: ['tests/integration/**/*.test.ts'], setupFiles: ['./tests/integration/setup.ts'] },
});
