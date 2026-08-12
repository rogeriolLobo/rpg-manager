import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/domain/**/*.ts', 'src/server/security/{crypto,headers}.ts', 'src/shared/validation/**/*.ts'],
      thresholds: { lines: 85, functions: 85, branches: 80, statements: 85 },
    },
  },
});

