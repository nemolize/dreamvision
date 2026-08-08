import { fileURLToPath } from "node:url";

import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import playwright from "eslint-plugin-playwright";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  includeIgnoreFile(fileURLToPath(new URL(".gitignore", import.meta.url))),
  // Warnings do not fail `eslint .`, so a disable directive that no longer
  // suppresses anything would otherwise survive CI indefinitely.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./tsconfig.node.json",
          "./e2e-tests/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  // No tsconfig includes JavaScript, so type-aware rules have no program to run
  // against and the parser errors on any file it reaches.
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.{test,spec}.{js,ts,jsx,tsx}"],
    // The E2E specs match this glob too, but they run under Playwright.
    ignores: ["e2e-tests/**"],
    extends: [vitest.configs.recommended],
    languageOptions: { globals: globals.vitest },
    rules: {
      // Errors because a warning does not fail the lint script. `.skipIf()`
      // remains for the run-time-conditional case.
      "vitest/no-disabled-tests": "error",
    },
  },
  {
    files: ["e2e-tests/**/*.{ts,tsx}"],
    extends: [playwright.configs["flat/recommended"]],
    rules: {
      // `test.skip(cond, reason)` stays allowed: it selects a target at run time.
      "playwright/no-skipped-test": ["error", { allowConditional: true }],
    },
  },
);
