import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeEach } from 'vitest';
import type { Env } from '../../src/server/types';

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
beforeEach(async () => { await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS); });
