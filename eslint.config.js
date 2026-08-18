import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".wrangler/**",
      "worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker, ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "vitest.integration.config.ts",
            "tests/integration/*.ts",
          ],
          // LIB-007: 16 batia certinho com a contagem de arquivos de integration test do
          // momento em que este limite foi definido — não era uma escolha à prova de
          // crescimento natural da suíte. Cada nova vertical da Library adiciona pelo menos
          // um arquivo novo em tests/integration/, e o lint quebra com um erro de config (não
          // um bug de código) toda vez que esse teto é ultrapassado. Ajustado para dar folga
          // real, evitando repetir esse ajuste a cada poucas tarefas.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-refresh/only-export-components": "off",
    },
  },
);
